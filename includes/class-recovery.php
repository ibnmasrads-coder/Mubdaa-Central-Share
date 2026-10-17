<?php
defined( 'ABSPATH' ) || exit;

/**
 * Read-only reconciliation for ambiguous MainWP bulk-post responses (e.g. 503).
 * Uses MainWP's authenticated Child query; never posts, updates, or guesses an ID.
 * A single exact title / publish-time match is required; ambiguity stays visible.
 */
final class MCS_Post_Recovery {
	const TTL = 1800;
	const MAX_RESULTS = 50;

	public static function register(): void {
		add_action( 'wp_ajax_mcs_recover_site', array( __CLASS__, 'lookup' ) );
		add_action( 'wp_ajax_mcs_recovery_begin', array( __CLASS__, 'begin' ) );
	}

	public static function remember_source( int $batch_id, string $title ): void {
		if ( ! $batch_id || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		set_transient(
			'mcs_recovery_' . get_current_user_id() . '_' . $batch_id,
			array( 'title' => self::normal_title( $title ), 'started' => time() ),
			self::TTL
		);
	}


	/**
	 * The editor may leave the bulk-posting page open before pressing Publish.
	 * Anchor the matching window to the first actual publishing request.
	 */
	public static function begin(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
		}
		$batch_id = isset( $_POST['post_id'] ) ? absint( $_POST['post_id'] ) : 0;
		if ( ! $batch_id ) {
			wp_send_json_error( array( 'message' => 'Invalid publication' ), 400 );
		}
		check_ajax_referer( 'mcs_recovery_' . $batch_id, 'nonce' );
		$key = 'mcs_recovery_' . get_current_user_id() . '_' . $batch_id;
		$source = get_transient( $key );
		if ( ! is_array( $source ) || ! is_string( $source['title'] ?? null ) ) {
			wp_send_json_error( array( 'message' => 'Recovery session expired; reload the posting page' ), 410 );
		}
		if ( empty( $source['first_publish_started'] ) ) {
			$source['started'] = time();
			$source['first_publish_started'] = true;
			set_transient( $key, $source, self::TTL );
		}
		wp_send_json_success( array( 'status' => 'ready' ) );
	}

	private static function normal_title( string $title ): string {
		$title = html_entity_decode( wp_strip_all_tags( $title ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		return trim( (string) preg_replace( '/\s+/u', ' ', $title ) );
	}

	public static function unique_match( $posts, string $title, int $started, int $now ): array {
		if ( ! is_array( $posts ) || count( $posts ) >= self::MAX_RESULTS ||
			array_keys( $posts ) !== range( 0, count( $posts ) - 1 ) ) {
			// Failure payloads / truncated result sets are not evidence of absence.
			return array( 'status' => 'unknown' );
		}
		$matches = array();
		foreach ( $posts as $post ) {
			if ( ! is_array( $post ) || 'publish' !== ( $post['status'] ?? null ) ) {
				continue;
			}
			$post_id = isset( $post['id'] ) && is_numeric( $post['id'] ) ? absint( $post['id'] ) : 0;
			$date = isset( $post['dts'] ) && is_numeric( $post['dts'] ) ? (int) $post['dts'] : 0;
			if ( $post_id > 0 && $date >= $started - 180 && $date <= $now + 120 &&
				self::normal_title( (string) ( $post['title'] ?? '' ) ) === $title ) {
				$matches[] = $post_id;
			}
		}
		if ( 1 === count( $matches ) ) {
			return array( 'status' => 'confirmed', 'post_id' => $matches[0] );
		}
		return array( 'status' => count( $matches ) ? 'ambiguous' : 'not_found' );
	}

	public static function lookup(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
		}
		$batch_id = isset( $_POST['post_id'] ) ? absint( $_POST['post_id'] ) : 0;
		$site_id = isset( $_POST['site_id'] ) ? absint( $_POST['site_id'] ) : 0;
		if ( ! $batch_id || ! $site_id ) {
			wp_send_json_error( array( 'message' => 'Invalid publication or site' ), 400 );
		}
		check_ajax_referer( 'mcs_recovery_' . $batch_id, 'nonce' );
		$source = get_transient( 'mcs_recovery_' . get_current_user_id() . '_' . $batch_id );
		if ( ! is_array( $source ) || ! is_string( $source['title'] ?? null ) ||
			'' === $source['title'] || ! is_int( $source['started'] ?? null ) ||
			time() - $source['started'] > self::TTL ) {
			wp_send_json_error( array( 'message' => 'Session expired' ), 410 );
		}
		if ( ! class_exists( '\\MainWP\\Dashboard\\MainWP_DB' ) ||
			! class_exists( '\\MainWP\\Dashboard\\MainWP_Connect' ) ) {
			wp_send_json_success( array( 'status' => 'unknown' ) );
		}
		try {
			$site = \MainWP\Dashboard\MainWP_DB::instance()->get_website_by_id( $site_id );
		} catch ( \Throwable $e ) {
			wp_send_json_success( array( 'status' => 'unknown' ) );
		}
		if ( ! is_object( $site ) || (int) ( $site->id ?? 0 ) !== $site_id ) {
			wp_send_json_success( array( 'status' => 'unknown' ) );
		}
		try {
			// The search is performed only on connected Child sites, via existing MainWP credentials.
			// Limit results and never retry an ambiguous or failed publishing POST.
			$posts = \MainWP\Dashboard\MainWP_Connect::fetch_url_authed(
				$site, 'get_all_posts',
				array(
					'post_type'       => 'post',
					'status'          => 'publish',
					'keyword'         => $source['title'],
					'search_on'       => 'title',
					'maxRecords'      => self::MAX_RESULTS,
					'where_post_date' => 1,
				),
				false, true, false
			);
		} catch ( \Throwable $e ) {
			wp_send_json_success( array( 'status' => 'unreachable' ) );
		}
		// A malformed MainWP response is not equivalent to zero published posts.
		if ( ! is_array( $posts ) || isset( $posts['error'] ) || isset( $posts['fetch_url_output'] ) ) {
			wp_send_json_success( array( 'status' => 'unreachable' ) );
		}
		$match = self::unique_match( $posts, $source['title'], $source['started'], time() );
		if ( 'confirmed' !== $match['status'] ) {
			wp_send_json_success( $match );
		}
		$site_url = isset( $site->url ) ? esc_url_raw( $site->url ) : '';
		$parts = wp_parse_url( $site_url );
		if ( ! is_array( $parts ) || ! in_array( strtolower( (string) ( $parts['scheme'] ?? '' ) ), array( 'http', 'https' ), true ) ||
			empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) ) {
			wp_send_json_success( array( 'status' => 'unknown' ) );
		}
		$url = esc_url_raw( add_query_arg( 'p', $match['post_id'], trailingslashit( $site_url ) ) );
		wp_send_json_success( array(
			'status' => 'confirmed',
			'url' => $url,
			'post_id' => $match['post_id'],
			'note' => 'Unique recent title match; verify featured image and article body',
		) );
	}
}
MCS_Post_Recovery::register();
