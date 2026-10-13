<?php
/**
 * Functional image endpoint smoke test.
 * Run: php tests/image-endpoint-smoke.php > /tmp/mcs-image-endpoint.png
 */
declare(strict_types=1);

define('ABSPATH','/tmp/wp/');
function add_action( $n, $cb ) {}
function current_user_can( $n ) { return $n === 'manage_options'; }
function sanitize_text_field( $value ) { return trim( $value ); }
function wp_unslash( $value ) { return $value; }
function check_ajax_referer( $action ) {
    $key = $_GET['batch'];
    if ($action !== 'mcs_source_' . $key) { throw new RuntimeException('Nonce mismatch'); }
}
function get_transient( $name ) {
    if ($name !== 'mcs_source_AbCdEfGhIjKlMnOpQrStUvWxYz123456') {
        throw new RuntimeException('Case was lost in transient key: ' . $name);
    }
    return array('uid'=>73,'attachment_id'=>87,'image_url'=>'https://example.com/image.png');
}
function get_current_user_id() { return 73; }
function absint($v) { return abs((int)$v); }
function get_attached_file($id) {
    $name = sys_get_temp_dir() . '/mcs-image-test-sample.png';
    $payload = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL0AAAAASUVORK5CYII=', true);
    file_put_contents($name,$payload);
    return $name;
}
function nocache_headers() {}
function wp_die($text, $title='', $args=array()) { throw new RuntimeException('Image endpoint error: ' . $text); }
require dirname(__DIR__) . '/mubdaa-central-share.php';
$_GET['batch']='AbCdEfGhIjKlMnOpQrStUvWxYz123456';
Mubdaa_Central_Share::serve_image();
