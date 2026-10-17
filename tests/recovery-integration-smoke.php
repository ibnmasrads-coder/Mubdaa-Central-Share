<?php
declare(strict_types=1);

namespace MainWP\Dashboard {
    final class MainWP_DB {
        public static function instance(): self { return new self(); }
        public function get_website_by_id(int $id): object {
            return (object) array('id'=>$id, 'url'=>'https://www.news.example.com');
        }
    }
    final class MainWP_Connect {
        public static $posts = array();
        public static $throw = false;
        public static $requests = array();
        public static function fetch_url_authed(&$website, $what, $params = array(),
            $check = false, $force = false, $retry = true) {
            self::$requests[] = array($website->id, $what, $params, $retry);
            if (self::$throw) throw new \Exception('HTTP 503');
            return self::$posts;
        }
    }
}

namespace {
define('ABSPATH', '/tmp/wp/');
$GLOBALS['mcs_transients'] = array();
function add_action($name,$callback,$priority=10,$args=1) {}
function current_user_can($cap) { return $cap === 'manage_options'; }
function absint($v) { return abs((int)$v); }
function get_post($id) { return (object)array('ID'=>$id, 'post_type'=>'post'); }
function get_the_title($id) { return 'خبر جديد'; }
function wp_strip_all_tags($s) { return strip_tags((string)$s); }
function get_current_user_id() { return 9; }
function set_transient($name,$data,$ttl) { $GLOBALS['mcs_transients'][$name] = $data; }
function get_transient($name) { return $GLOBALS['mcs_transients'][$name] ?? false; }
function check_ajax_referer($action,$field) {
    if ($action !== 'mcs_recovery_88' || ($_POST[$field] ?? '') !== 'nonce') throw new \Exception('CSRF check');
}
function esc_url_raw($url) { return $url; }
function wp_parse_url($url) { return parse_url($url); }
function trailingslashit($url) { return rtrim($url,'/') . '/'; }
function add_query_arg($key,$value,$url) { return $url . '?' . $key . '=' . $value; }
final class Response extends \Exception {
    public $success;
    public $data;
    public function __construct(bool $success, $data) { $this->success=$success; $this->data=$data; }
}
function wp_send_json_success($data) { throw new Response(true,$data); }
function wp_send_json_error($data,$status=400) { throw new Response(false,$data); }
function check($condition, $message) { if(!$condition) throw new \Exception($message); }
require dirname(__DIR__) . '/includes/class-recovery.php';

MCS_Post_Recovery::remember_source(88,'خبر جديد');
$session = 'mcs_recovery_9_88';
check(isset($GLOBALS['mcs_transients'][$session]),'session was created');
$_POST = array('post_id'=>88,'site_id'=>31,'nonce'=>'nonce');
try { MCS_Post_Recovery::begin(); } catch(Response $e) {
    check($e->success && $e->data['status']==='ready','begin accepted');
}
check($GLOBALS['mcs_transients'][$session]['first_publish_started'] === true,'window stamped');
unset($GLOBALS['mcs_transients'][$session]);
try { MCS_Post_Recovery::begin(); } catch(Response $e) {
    check($e->success && $e->data['status']==='ready','source rebuilt after long edit without guessing');
}
check($GLOBALS['mcs_transients'][$session]['first_publish_started'] === true,'rebuilt session stamped');

$now=time();
\MainWP\Dashboard\MainWP_Connect::$posts=array(array(
    'id'=>1100488,'title'=>'خبر جديد','status'=>'publish','dts'=>$now-30
));
try { MCS_Post_Recovery::lookup(); throw new \Exception('Unexpected response'); } catch(Response $e) {
    check($e->success,'readback success');
    check($e->data['status']==='confirmed','one recent exact title');
    check($e->data['url']==='https://www.news.example.com/?p=1100488','correct verified child ID');
}
$call=end(\MainWP\Dashboard\MainWP_Connect::$requests);
check($call[1]==='get_all_posts' && $call[2]['where_post_date']===1,'read-only MainWP Child query');
check($call[3]===false,'no automatic failed request retry');
$duplicate = array(array('id'=>1100499,'title'=>'خبر جديد','status'=>'publish','dts'=>$now-20));
\MainWP\Dashboard\MainWP_Connect::$posts = array_merge(\MainWP\Dashboard\MainWP_Connect::$posts,$duplicate);
try { MCS_Post_Recovery::lookup(); throw new \Exception('Unexpected response'); } catch(Response $e) {
    check($e->data['status']==='ambiguous','ambiguous must not produce URL');
}
\MainWP\Dashboard\MainWP_Connect::$throw = true;
try { MCS_Post_Recovery::lookup(); throw new \Exception('Unexpected response'); } catch(Response $e) {
    check($e->data['status']==='unreachable','503 must remain unconfirmed');
}
echo "PASS: MainWP connection contract, safe readback, no writes or invented IDs\n";
}
