<?php
/**
 * Standalone isolation smoke test: no WordPress DB, MainWP or HTTP required.
 * Usage: php tests/isolation-smoke.php
 */
declare(strict_types=1);

define( 'ABSPATH', '/tmp/wp/' );
define( 'MINUTE_IN_SECONDS', 60 );

$recorded = array( 'scripts' => array(), 'styles' => array(), 'transients' => array(), 'localize' => array() );

function add_action( $name, $callback ) { /* plugin boot registration only */ }
function is_admin() { return true; }
function current_user_can( $cap ) { return 'manage_options' === $cap; }
function sanitize_key( $value ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) ); }
function wp_unslash( $value ) { return $value; }
function absint( $value ) { return abs( (int) $value ); }
function get_post( $id ) { return (object) array( 'ID' => $id, 'post_type' => 'post' ); }
function get_post_thumbnail_id( $post_id ) { return 42; }
function wp_get_attachment_url( $id ) { return 'https://main.example.com/uploads/story.jpeg'; }
function get_the_post_thumbnail_url( $id, $size ) { return false; }
function esc_url_raw( $url ) { return $url; }
function wp_generate_password( $length, $special, $extra ) { return str_repeat( 'a', $length ); }
function set_transient( $key, $data, $ttl ) { global $recorded; $recorded['transients'][ $key ] = $data; }
function wp_enqueue_style( $handle, $url, $deps, $version ) { global $recorded; $recorded['styles'][] = $handle; }
function plugins_url( $path, $file ) { return 'https://main.example.com/wp-content/plugins/mubdaa-central-share/' . $path; }
function wp_enqueue_script( $handle, $url, $deps, $version, $footer ) { global $recorded; $recorded['scripts'][] = $handle; }
function wp_localize_script( $handle, $name, $value ) { global $recorded; $recorded['localize'] = $value; }
function get_the_title( $id ) { return 'خبر جديد'; }
function wp_strip_all_tags( $text ) { return strip_tags( $text ); }
function admin_url( $path ) { return 'https://main.example.com/wp-admin/' . $path; }
function add_query_arg( $query, $url ) { return $url . '?' . http_build_query( $query ); }
function wp_create_nonce( $action ) { return 'demo'; }
function get_current_user_id() { return 9; }
function get_post_meta( $post_id, $key, $single ) { return ''; }

require dirname( __DIR__ ) . '/mubdaa-central-share.php';

function assert_true( bool $ok, string $message ): void {
	if ( ! $ok ) {
		fwrite( STDERR, "FAIL: $message\n" );
		exit( 1 );
	}
}

$_GET['page'] = 'PostingBulkPost';
$_GET['id']   = '123';
Mubdaa_Central_Share::enqueue();

global $recorded;
assert_true( in_array( 'mcs-share', $recorded['scripts'], true ), 'JS registered on MainWP post screen' );
assert_true( in_array( 'mcs-share', $recorded['styles'], true ), 'CSS registered on MainWP post screen' );
assert_true( true === $recorded['localize']['hasImage'], 'Featured image found' );
assert_true( 'خبر جديد' === $recorded['localize']['title'], 'Source title captured' );
assert_true( count( $recorded['transients'] ) === 2, 'Temporary image reference and readback session only' );
assert_true( isset( $recorded['transients']['mcs_recovery_9_123'] ), 'Readback session scoped by user and batch' );
assert_true( ! array_key_exists( 'links', reset( $recorded['transients'] ) ), 'No results saved in transient' );

ob_start();
Mubdaa_Central_Share::render_panel();
$html = ob_get_clean();
assert_true( false !== strpos( $html, 'mcs-share-panel' ), 'Overlay markup printed only on dashboard' );
assert_true( false !== strpos( $html, 'mcs-copy-image' ), 'Image clipboard UI exists' );

$_GET['page'] = 'PostBulkManage';
$recorded['scripts'] = array();
Mubdaa_Central_Share::enqueue();
assert_true( count( $recorded['scripts'] ) === 0, 'Does not inject on another page' );
ob_start();
Mubdaa_Central_Share::render_panel();
$html = ob_get_clean();
assert_true( '' === $html, 'No overlay output outside MainWP posting screen' );

fwrite( STDOUT, "PASS: Dashboard-only injection, metadata capture, no durable results, UI buttons\n" );
