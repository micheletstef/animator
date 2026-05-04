<?php
/**
 * Webhook receiver for GitHub push → git pull on server.
 *
 * On the server: copy this file to deploy.php, set $secret and $repo, and
 * point your GitHub webhook (same secret) at this URL.
 * deploy.php is gitignored so git reset --hard does not remove it.
 */

$secret = 'PASTE_THE_SAME_SECRET_AS_IN_GITHUB_WEBHOOK_SETTINGS';
$repo = '/home/stefmich/tools/animator';

$signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$payload = file_get_contents('php://input');

$expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);

if (!hash_equals($expected, $signature)) {
    http_response_code(403);
    die('Forbidden');
}

$output = [];
$returnCode = 0;

if (!is_dir($repo)) {
    $output[] = "ERROR: Repo path does not exist: {$repo}";
    http_response_code(500);
} elseif (!is_dir($repo . '/.git')) {
    $output[] = "ERROR: Not a git repository: {$repo}";
    http_response_code(500);
} else {
    $fetchOut = [];
    exec('git -C ' . escapeshellarg($repo) . ' fetch origin 2>&1', $fetchOut, $fetchRc);
    $output[] = 'fetch: ' . implode("\n", $fetchOut);
    $output[] = 'fetch exit: ' . $fetchRc;

    $resetOut = [];
    exec('git -C ' . escapeshellarg($repo) . ' reset --hard origin/main 2>&1', $resetOut, $returnCode);
    $output[] = 'reset: ' . implode("\n", $resetOut);
    $output[] = 'reset exit: ' . $returnCode;

    if ($fetchRc !== 0 || $returnCode !== 0) {
        http_response_code(500);
    }
}

$log = date('Y-m-d H:i:s') . "\n" . implode("\n", $output) . "\n\n";
file_put_contents(__DIR__ . '/deploy.log', $log, FILE_APPEND);

echo implode("\n", $output);
