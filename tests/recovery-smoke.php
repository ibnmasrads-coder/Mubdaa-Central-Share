<?php
declare(strict_types=1);
define('ABSPATH','/tmp/wp/');
function add_action($hook, $callback, $priority = 10, $args = 1) {}
function absint($x) { return abs((int)$x); }
function wp_strip_all_tags($x) { return strip_tags((string)$x); }
require dirname(__DIR__) . '/includes/class-recovery.php';

$now = time();
$title = 'خبر عالمي جديد';
$good = array('id'=>1100001, 'status'=>'publish', 'title'=>$title, 'dts'=>$now-50);
function check($yes, $message) { if (!$yes) throw new Exception($message); }

$match = MCS_Post_Recovery::unique_match(array($good), $title, $now-60, $now);
check($match['status']==='confirmed' && $match['post_id']===1100001,'one exact published recent match must be confirmed');
$other = $good; $other['id'] = 1100002;
check(MCS_Post_Recovery::unique_match(array($good,$other),$title,$now-60,$now)['status']==='ambiguous','duplicate title must be rejected');
$old = $good; $old['dts'] = $now - 3000;
check(MCS_Post_Recovery::unique_match(array($old),$title,$now,$now)['status']==='not_found','old articles must not be recovered');
$wrong = $good; $wrong['title'] = 'عنوان مشابه';
check(MCS_Post_Recovery::unique_match(array($wrong),$title,$now,$now)['status']==='not_found','different title must be rejected');
$draft = $good; $draft['status'] = 'draft';
check(MCS_Post_Recovery::unique_match(array($draft),$title,$now,$now)['status']==='not_found','draft never counted as published');
check(MCS_Post_Recovery::unique_match(array_fill(0,50,$good),$title,$now,$now)['status']==='unknown','bounded/truncated response must remain uncertain');
check(MCS_Post_Recovery::unique_match(array('error'=>'NOMAINWP'),$title,$now,$now)['status']==='not_found','unusable child response cannot invent ID');
echo "PASS: strict unique published-title readback, recency, status, ambiguity and bounded results\n";
