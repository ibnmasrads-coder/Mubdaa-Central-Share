<?php
/**
 * Plugin Name: Mubdaa Central Share
 * Description: Desktop-only MainWP publish-result sharing with a real, copyable featured-image card and selected article links.
 * Version: 0.4.1-dev
 * Requires at least: 6.3
 * Requires PHP: 8.0
 * Author: Mubdaa
 * License: GPL-2.0-or-later
 * Text Domain: mubdaa-central-share
 */

defined( 'ABSPATH' ) || exit;

final class Mubdaa_Central_Share {
	const VERSION = '0.4.1-dev';
	const MAX_IMAGE_BYTES = 12582912; // 12 MiB.
	const MAX_IMAGE_PIXELS = 24000000;
	const TTL = 1800; // Ephemeral source metadata only; no publication/share history.

	public static function boot(): void {
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'admin_footer', array( __CLASS__, 'render_panel' ) );
		add_action( 'wp_ajax_mcs_featured_image', array( __CLASS__, 'serve_image' ) );
	}

	private static function on_posting_screen(): bool {
		if ( ! is_admin() || ! current_user_can( 'manage_options' ) ) {
			return false;
		}
		// Don't inject UI anywhere else or modify MainWP classes/assets.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
		return 'postingbulkpost' === $page;
	}

	private static function find_image( int $post_id ): array {
		$attachment_id = (int) get_post_thumbnail_id( $post_id );
		$image_url = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';

		if ( ! is_string( $image_url ) || '' === $image_url ) {
			$image_url = get_the_post_thumbnail_url( $post_id, 'full' );
		}
		if ( ! is_string( $image_url ) || '' === $image_url ) {
			foreach ( array( 'fifu_image_url', '_mcm_featured_url' ) as $key ) {
				$value = get_post_meta( $post_id, $key, true );
				if ( is_string( $value ) && '' !== trim( $value ) ) {
					$image_url = $value;
					break;
				}
			}
		}

		return array(
			'attachment_id' => $attachment_id,
			'url'           => is_string( $image_url ) ? esc_url_raw( $image_url ) : '',
		);
	}

	public static function enqueue(): void {
		if ( ! self::on_posting_screen() ) {
			return;
		}
		$post_id = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
		if ( ! $post_id ) {
			return;
		}
		$post = get_post( $post_id );
		if ( ! $post || 'revision' === $post->post_type ) {
			return;
		}

		// MainWP may delete the temporary dashboard post on the final AJAX result.
		// Capture the source title and attachment reference before its page callback runs.
		$image = self::find_image( $post_id );
		MCS_Post_Recovery::remember_source( $post_id, html_entity_decode( get_the_title( $post_id ), ENT_QUOTES, 'UTF-8' ) );
		$key = wp_generate_password( 32, false, false );
		set_transient(
			'mcs_source_' . $key,
			array(
				'uid'           => get_current_user_id(),
				'attachment_id' => $image['attachment_id'],
				'image_url'     => $image['url'],
			),
			self::TTL
		);

		wp_enqueue_style(
			'mcs-share',
			plugins_url( 'assets/share.css', __FILE__ ),
			array(),
			self::VERSION
		);
		wp_enqueue_script(
			'mcs-documents',
			plugins_url( 'assets/documents.bundle.js', __FILE__ ),
			array(),
			self::VERSION,
			true
		);
		wp_enqueue_script(
			'mcs-share',
			plugins_url( 'assets/share.js', __FILE__ ),
			array( 'jquery', 'mcs-documents' ),
			self::VERSION,
			true
		);
		wp_localize_script(
			'mcs-share',
			'mcsShare',
			array(
				'title'          => html_entity_decode( get_the_title( $post_id ), ENT_QUOTES, 'UTF-8' ),
				'hasImage'       => '' !== $image['url'],
				'imageEndpoint'  => add_query_arg(
					array(
						'action'   => 'mcs_featured_image',
						'batch'    => $key,
						'_wpnonce' => wp_create_nonce( 'mcs_source_' . $key ),
					),
					admin_url( 'admin-ajax.php' )
				),
				'expectedSites'  => 0, // JS derives this from MainWP's own queued site rows.
				'webUrl'         => 'https://web.whatsapp.com/',
				'postId'         => $post_id,
				'shortlinksEndpoint' => admin_url( 'admin-ajax.php' ),
				'shortlinksNonce' => wp_create_nonce( 'mcs_shortlinks_' . $post_id ),
			'recoveryEndpoint' => admin_url( 'admin-ajax.php' ),
			'recoveryNonce' => wp_create_nonce( 'mcs_recovery_' . $post_id ),
				'captionGuide'   => 1024, // Image-caption size guidance. No truncation or splitting.
				'strings' => array(
					'noImage'       => 'لا توجد صورة بارزة يمكن الوصول إليها لهذا المقال. لن نجهز مشاركة بدون صورة.',
					'imageError'    => 'تعذر تحميل الصورة. راجع كود الخطأ الظاهر لتحديد السبب.',
					'copyFailed'    => 'المتصفح لم يسمح بنسخ الصورة مباشرة. استخدم تحميل الصورة ثم أرفقها يدويًا.',
				),
			)
		);
	}

	public static function render_panel(): void {
		if ( ! self::on_posting_screen() ) {
			return;
		}
		?>
		<section id="mcs-share-panel" class="mcs-panel" dir="rtl" aria-label="تجهيز مشاركة واتساب" hidden>
			<div class="mcs-card">
				<header class="mcs-header">
					<div><strong>مشاركة الخبر عبر واتساب</strong><small id="mcs-status" aria-live="polite">تجميع روابط النشر…</small></div>
					<button class="mcs-dismiss" type="button" id="mcs-close" aria-label="إغلاق">×</button>
				</header>
				<div class="mcs-content">
					<div id="mcs-warning" class="mcs-warning" hidden></div>
					<label class="mcs-label" for="mcs-title">عنوان المقال على بطاقة الصورة</label>
					<textarea id="mcs-title" class="mcs-title-input" rows="2" maxlength="400"></textarea>
					<div class="mcs-sites-header"><strong>روابط النشر المؤكدة</strong><span id="mcs-selected-count"></span></div>
					<div class="mcs-recovery" role="status" aria-live="polite"><span id="mcs-recovery-status"></span><button type="button" id="mcs-retry-recovery" hidden>إعادة التحقق من المواقع غير المؤكدة</button></div>
					<div class="mcs-select-actions">
						<button id="mcs-select-all" type="button">تحديد الكل</button>
						<button id="mcs-select-none" type="button">إلغاء التحديد</button>
					</div>
					<div id="mcs-sites" class="mcs-sites" role="group" aria-label="المواقع المتاحة للمشاركة"></div>
					<div class="mcs-preview-wrap">
						<strong>معاينة بطاقة الصورة</strong>
						<canvas id="mcs-canvas" role="img" aria-label="بطاقة الصورة البارزة مع عنوان الخبر"></canvas>
						<div id="mcs-image-state" class="mcs-hint" aria-live="polite">جاري تجهيز البطاقة…</div>
						<button type="button" id="mcs-retry-image" hidden>إعادة محاولة تحميل الصورة</button>
					</div>
					<div class="mcs-sharing-options">
						<label><input id="mcs-omit-www" type="checkbox"> حذف www. من الروابط (اختياري — تأكد أن الدومينات تعمل بدونها)</label>
						<label><input id="mcs-split-captions" type="checkbox"> تقسيم نص واتساب إلى مجموعات (اختياري)</label>
						<div id="mcs-split-settings" hidden><label for="mcs-split-count">عدد المجموعات</label>
							<select id="mcs-split-count"><option value="2">مجموعتان</option><option value="3">3 مجموعات</option><option value="4">4 مجموعات</option></select>
							<small>كل مجموعة تُنسخ وتُرسل على حدة. لا يؤثر التقسيم على PDF أو Word.</small>
						</div>
						<div id="mcs-caption-groups" hidden></div>
					</div>
					<div class="mcs-caption-wrap">
						<div class="mcs-caption-head">
							<strong>جميع روابط الخبر — نص واحد</strong><small id="mcs-caption-progress"></small>
						</div>
						<textarea id="mcs-caption" rows="5" readonly spellcheck="false"></textarea>
					</div>
					<div class="mcs-steps">
						<b>ترتيب المشاركة الصحيح على الكمبيوتر:</b>
						<span>1. انسخ الصورة، ثم الصقها في واتساب ويب أو سطح المكتب باستخدام Ctrl+V.</span>
						<span>2. انسخ كل الروابط مرة واحدة. الصقها في وصف الصورة إذا قبلها واتساب بالكامل.</span>
						<span>3. لو تجاوز النص حد وصف الصور، أرسل الصورة ثم الصق كل الروابط كرسالة نصية واحدة.</span>
					</div>
				</div>
				<footer class="mcs-footer">
					<button type="button" id="mcs-copy-image" class="mcs-primary" disabled>1. نسخ الصورة</button>
					<button type="button" id="mcs-download-image" disabled>تحميل PNG</button>
					<button type="button" id="mcs-copy-caption" disabled>2. نسخ كل الروابط</button>
					<button type="button" id="mcs-download-pdf" disabled>تنزيل PDF</button>
					<button type="button" id="mcs-download-docx" disabled>تنزيل Word</button>
					<a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer">فتح واتساب ويب ↗</a>
				</footer>
				<div id="mcs-toast" role="status" aria-live="polite"></div>
			</div>
		</section>
		<?php
	}

	private static function allowed_image_url( string $url ): bool {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || 'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) )
			|| empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] )
			|| isset( $parts['fragment'] ) ) {
			return false;
		}
		$host = strtolower( (string) $parts['host'] );
		$permitted = array( strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) );
		$central = get_option( 'mcm_origin_url', '' );
		if ( is_string( $central ) && '' !== $central ) {
			$central_host = strtolower( (string) wp_parse_url( $central, PHP_URL_HOST ) );
			if ( '' !== $central_host ) {
				$permitted[] = $central_host;
			}
		}
		return in_array( $host, $permitted, true );
	}

	public static function serve_image(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not authorized', '', array( 'response' => 403 ) );
		}
		// sanitize_key() lowercases mixed-case secrets and breaks transient lookup and nonce.
		$key = isset( $_GET['batch'] ) && is_string( $_GET['batch'] ) ? sanitize_text_field( wp_unslash( $_GET['batch'] ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9]{32}$/D', $key ) ) {
			wp_die( 'Invalid request', '', array( 'response' => 400 ) );
		}
		check_ajax_referer( 'mcs_source_' . $key );
		$data = get_transient( 'mcs_source_' . $key );
		if ( ! is_array( $data ) || (int) ( $data['uid'] ?? 0 ) !== get_current_user_id() ) {
			wp_die( 'Share session expired', '', array( 'response' => 410 ) );
		}

		$bytes = false;
		$attachment_id = absint( $data['attachment_id'] ?? 0 );
		if ( $attachment_id ) {
			$file = get_attached_file( $attachment_id );
			if ( is_string( $file ) && is_readable( $file ) && is_file( $file )
				&& filesize( $file ) <= self::MAX_IMAGE_BYTES ) {
				$bytes = file_get_contents( $file );
			}
		}
		if ( false === $bytes ) {
			$url = (string) ( $data['image_url'] ?? '' );
			if ( ! self::allowed_image_url( $url ) ) {
				wp_die( 'Image host not approved', '', array( 'response' => 422 ) );
			}
			$response = wp_safe_remote_get(
				$url,
				array(
					'timeout'             => 15,
					'redirection'         => 3, // Safe redirects validated by wp_safe_remote_get.
					'limit_response_size' => self::MAX_IMAGE_BYTES + 1,
					'headers'             => array( 'Accept' => 'image/jpeg,image/png,image/webp' ),
				)
			);
			if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
				wp_die( 'Source image unavailable', '', array( 'response' => 502 ) );
			}
			$bytes = wp_remote_retrieve_body( $response );
		}
		if ( ! is_string( $bytes ) || 0 === strlen( $bytes ) || strlen( $bytes ) > self::MAX_IMAGE_BYTES ) {
			wp_die( 'Invalid image size', '', array( 'response' => 422 ) );
		}
		if ( ! function_exists( 'getimagesizefromstring' ) ) {
			wp_die( 'Image validation unavailable', '', array( 'response' => 500 ) );
		}
		$info = @getimagesizefromstring( $bytes ); // Validates the actual binary signature.
		if ( ! is_array( $info ) || empty( $info['mime'] ) ||
			! in_array( $info['mime'], array( 'image/jpeg', 'image/png', 'image/webp' ), true ) ||
			(int) $info[0] < 1 || (int) $info[1] < 1 ||
			(int) $info[0] > 12000 || (int) $info[1] > 12000 ||
			( (int) $info[0] * (int) $info[1] ) > self::MAX_IMAGE_PIXELS ) {
			wp_die( 'Unsupported image file', '', array( 'response' => 422 ) );
		}
		nocache_headers();
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Content-Type: ' . $info['mime'] );
		header( 'Content-Length: ' . strlen( $bytes ) );
		echo $bytes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- validated image binary.
		exit;
	}
}

require_once __DIR__ . '/includes/class-shortlinks.php';
require_once __DIR__ . '/includes/class-recovery.php';
Mubdaa_Central_Share::boot();
