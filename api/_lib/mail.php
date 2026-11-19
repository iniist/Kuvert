<?php
/*
 * Benachrichtigungs-Mails. Enthalten nie den Inhalt der Nachricht.
 * Transporte: smtp (eigener Mini-Client, SSL/STARTTLS + AUTH LOGIN), mail (PHP mail()), log (Datei, zum Testen).
 */
declare(strict_types=1);

function kv_mail_enabled(): bool
{
    $m = kv_config()['mail'];
    return !empty($m['enabled']) && (string)$m['from'] !== '';
}

function kv_notify_event(string $to, string $event, string $id, int $when): void
{
    if (!kv_mail_enabled() || $to === '') {
        return;
    }
    $time = date('d.m.Y \u\m H:i \U\h\r', $when);
    $ref = substr($id, 0, 6);
    $site = rtrim((string)kv_config()['site_url'], '/');
    if ($event === 'read') {
        $subject = 'Dein Kuvert wurde geöffnet';
        $body = "Hallo,\n\n"
            . "dein Kuvert (Kennung {$ref}…) wurde am {$time} geöffnet.\n"
            . "Die Nachricht ist jetzt vom Server gelöscht und kann nicht noch einmal gelesen werden.\n\n"
            . "Wenn die Empfängerin oder der Empfänger sagt, sie oder er hat nichts geöffnet,\n"
            . "hat jemand anderes den Link benutzt. Dann solltest du das Geheimnis (z. B. das Passwort) ändern.\n\n";
    } elseif ($event === 'destroyed') {
        $subject = 'Dein Kuvert wurde vernichtet';
        $body = "Hallo,\n\n"
            . "für dein Kuvert (Kennung {$ref}…) wurde am {$time} mehrfach ein falsches Passwort eingegeben.\n"
            . "Zur Sicherheit wurde die Nachricht gelöscht, ohne dass sie gelesen wurde.\n\n"
            . "Falls das nicht die richtige Person war, hat jemand anderes den Link. Schick bei Bedarf ein neues Kuvert.\n\n";
    } else {
        return;
    }
    $body .= "Diese Mail wurde einmalig verschickt, weil beim Erstellen eine Benachrichtigung gewünscht war.\n"
        . "Deine E-Mail-Adresse ist damit vom Server gelöscht.\n\n— Kuvert Pro · {$site}/pro.html\n";
    kv_mail_send($to, $subject, $body);
}

function kv_mail_send(string $to, string $subject, string $body, string $replyTo = ''): void
{
    $m = kv_config()['mail'];
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to)) {
        throw new RuntimeException('invalid recipient');
    }
    $from = (string)$m['from'];
    $fromName = (string)$m['from_name'];
    $transport = (string)$m['transport'];
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
    $domain = substr(strrchr($from, '@') ?: '@localhost', 1);

    $headers = [
        'Date: ' . date('r'),
        "From: {$encName} <{$from}>",
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'Auto-Submitted: auto-generated',
    ];
    if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL) && !preg_match('/[\r\n]/', $replyTo)) {
        $headers[] = "Reply-To: <{$replyTo}>";
    }
    $encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"));

    if ($transport === 'log') {
        $line = date('c') . "\tTo: {$to}\tSubject: {$subject}" . ($replyTo !== '' ? "\tReply-To: {$replyTo}" : '') . "\n" . $body . "\n---\n";
        file_put_contents(dirname(__DIR__) . '/_data/mail.log', $line, FILE_APPEND | LOCK_EX);
        return;
    }
    if ($transport === 'mail') {
        if (!mail($to, $encSubject, $encodedBody, implode("\r\n", $headers), '-f' . $from)) {
            throw new RuntimeException('mail() failed');
        }
        return;
    }
    $all = array_merge($headers, ["To: <{$to}>", "Subject: {$encSubject}"]);
    kv_smtp_send($m['smtp'], $from, $to, implode("\r\n", $all) . "\r\n\r\n" . $encodedBody . "\r\n");
}

/** @param array<string,mixed> $c */
function kv_smtp_send(array $c, string $from, string $to, string $data): void
{
    $host = (string)$c['host'];
    $port = (int)$c['port'];
    $secure = (string)($c['secure'] ?? 'ssl');
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host]]);
    $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        throw new RuntimeException("smtp connect: {$errstr} ({$errno})");
    }
    stream_set_timeout($fp, 15);

    $expect = static function (array $codes) use ($fp): string {
        $resp = '';
        while (($line = fgets($fp, 2048)) !== false) {
            $resp .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        $code = (int)substr($resp, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException('smtp: ' . trim($resp));
        }
        return $resp;
    };
    $send = static function (string $line) use ($fp): void {
        fwrite($fp, $line . "\r\n");
    };

    try {
        $expect([220]);
        $ehlo = 'kuvert.' . (substr(strrchr($from, '@') ?: '@localhost', 1));
        $send("EHLO {$ehlo}");
        $expect([250]);
        if ($secure === 'tls') {
            $send('STARTTLS');
            $expect([220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('smtp: starttls failed');
            }
            $send("EHLO {$ehlo}");
            $expect([250]);
        }
        if ((string)$c['user'] !== '') {
            $send('AUTH LOGIN');
            $expect([334]);
            $send(base64_encode((string)$c['user']));
            $expect([334]);
            $send(base64_encode((string)$c['pass']));
            $expect([235]);
        }
        $send("MAIL FROM:<{$from}>");
        $expect([250]);
        $send("RCPT TO:<{$to}>");
        $expect([250, 251]);
        $send('DATA');
        $expect([354]);
        // Dot-Stuffing: Zeilen, die mit "." beginnen, verdoppeln.
        $payload = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
        fwrite($fp, $payload);
        $send('.');
        $expect([250]);
        $send('QUIT');
    } finally {
        fclose($fp);
    }
}
