<?php
defined( 'ABSPATH' ) || exit;

/**
 * Capture MainWP's verified child post IDs during publication.
 * Data is temporary and not a share history.
 */
final class MCS_Child_Shortlinks {
	const TTL = 1800;

	public static function register(): void {
		add_action( 'mainwp_bulkposting_done', array( __CLASS__, 'capture' ), 20, 3 );
		add_action( 'wp_ajax_mcs_shortlinks', array( __CLASS__, 'get_links' ) );
	}

	public static function capture( $source, $site, $result ): void {
		if ( ! current_user_can( 'manage_options' ) ||
			! is_object( $source ) || ! is_object( $site ) || ! is_object( $result ) ) {
			return;
		}
		$batch_id = absint( $source->ID ?? 0 );
		$site_id = absint( $site->id ?? 0 );
		$child_id = isset( $result->added_id[ $site_id ] ) ? absint( $result->added_id[ $site_id ] ) : 0;
		if ( ! $batch_id || ! $site_id || ! $child_id || empty( $result->ok[ $site_id ] ) ) {
			return;
		}
		$home = isset( $site->url ) ? esc_url_raw( (string) $site->url ) : '';
		$parts = wp_parse_url( $home );
		if ( ! is_array( $parts ) || empty( $parts['host'] )
			|| ! in_array( strtolower( (string) ( $parts['scheme'] ?? '' ) ), array( 'http', 'https' ), true )
			|| isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) ) {
			return;
		}
		$url = esc_url_raw( add_query_arg( 'p', $child_id, trailingslashit( $home ) ) );
		set_transient(
			'mcs_child_' . get_current_user_id() . '_' . $batch_id . '_' . $site_id,
			$url,
			self::TTL
		);
	}

	public static function get_links(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Access denied' ), 403 );
		}
		$batch_id = isset( $_POST['post_id'] ) ? absint( $_POST['post_id'] ) : 0;
		if ( ! $batch_id ) {
			wp_send_json_error( array( 'message' => 'Invalid publication' ), 400 );
		}
		check_ajax_referer( 'mcs_shortlinks_' . $batch_id, 'nonce' );
		$ids = isset( $_POST['sites'] ) && is_array( $_POST['sites'] ) ? wp_unslash( $_POST['sites'] ) : array();
		$links = array();
		foreach ( array_slice( $ids, 0, 500 ) as $id ) {
			$site_id = absint( $id );
			if ( ! $site_id ) {
				continue;
			}
			$url = get_transient( 'mcs_child_' . get_current_user_id() . '_' . $batch_id . '_' . $site_id );
			if ( is_string( $url ) && '' !== $url ) {
				$links[ (string) $site_id ] = esc_url_raw( $url );
			}
		}
		wp_send_json_success( array( 'links' => $links ) );
	}
}
MCS_Child_Shortlinks::register();
