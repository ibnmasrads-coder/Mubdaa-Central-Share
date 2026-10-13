<?php
declare(strict_types=1);
define('ABSPATH','/tmp/wp/');
$records=array();
function add_action($tag,$callback,$priority=10,$argc=1){}
function current_user_can($cap){return true;}
function absint($value){return abs((int)$value);}
function esc_url_raw($url){return $url;}
function wp_parse_url($url){return parse_url($url);}
function trailingslashit($url){return rtrim($url,'/').'/';}
function add_query_arg($key,$value,$url){return $url.'?'.$key.'='.$value;}
function get_current_user_id(){return 7;}
function set_transient($name,$val,$ttl){global $records;$records[$name]=$val;}
function get_transient($name){global $records;return $records[$name]??false;}
function wp_unslash($input){return $input;}
function wp_send_json_error($data,$status){throw new Exception('Unexpected error '.json_encode($data));}
function wp_send_json_success($data){throw new SuccessResponse($data);}
function check_ajax_referer($action,$field){if($action!=='mcs_shortlinks_88'||$_POST[$field]!=='nonce'){throw new Exception('Invalid nonce');}}
final class SuccessResponse extends Exception {
  public $payload;
  public function __construct($payload){$this->payload=$payload;}
}
require dirname(__DIR__).'/includes/class-shortlinks.php';
$central=(object)array('ID'=>88);
$results=(object)array('ok'=>array(31=>1),'added_id'=>array(31=>932));
MCS_Child_Shortlinks::capture($central,(object)array('id'=>31,'url'=>'https://www.jawharksa.com'),$results);
$results=(object)array('ok'=>array(65=>1),'added_id'=>array(65=>1248));
MCS_Child_Shortlinks::capture($central,(object)array('id'=>65,'url'=>'https://www.wijhatsaudi.com'),$results);
if(count($records)!==2)throw new Exception('Must store one ephemeral URL per site');
$_POST=array('post_id'=>88,'nonce'=>'nonce','sites'=>array(31,65,999));
try {
  MCS_Child_Shortlinks::get_links();
  throw new Exception('Expected response');
} catch(SuccessResponse $e){
  $links=$e->payload['links'];
  if(($links[31]??'')!=='https://www.jawharksa.com/?p=932')throw new Exception('Wrong ID 31 link');
  if(($links[65]??'')!=='https://www.wijhatsaudi.com/?p=1248')throw new Exception('Wrong ID 65 link');
  if(isset($links[999]))throw new Exception('Unverified link must not be invented');
}
echo "PASS: per-site child IDs, mixed domains and no guessed link\n";
