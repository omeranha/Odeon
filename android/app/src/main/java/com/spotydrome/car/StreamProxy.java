package com.spotydrome.car;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

// MediaPlayer on Android 4.2 makes its own HTTPS connections with the system's outdated roots, so it can't open the
// server directly. It reads from this loopback server instead, which fetches through Tls.
final class StreamProxy {

    private static final String TAG = "StreamProxy";
    private static final int MAX_ROUTES = 20;

    private final Context context;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, String> routes = Collections.synchronizedMap(new LinkedHashMap<String, String>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > MAX_ROUTES;
        }
    });
    private ServerSocket server;

    StreamProxy(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void start() throws IOException {
        if (server != null) {
            return;
        }
        server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        Thread acceptor = new Thread(this::acceptLoop, "stream-proxy");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    synchronized void stop() {
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
                // Already closed.
            }
            server = null;
        }
    }

    // The upstream URL carries the Subsonic token, so MediaPlayer only ever sees an opaque local id.
    String localUrlFor(String upstreamUrl) throws IOException {
        start();
        String id = Long.toHexString(random.nextLong()) + Long.toHexString(random.nextLong());
        routes.put(id, upstreamUrl);
        return "http://127.0.0.1:" + server.getLocalPort() + "/s/" + id;
    }

    private void acceptLoop() {
        ServerSocket socket = server;
        while (socket != null && !socket.isClosed()) {
            try {
                Socket client = socket.accept();
                Thread worker = new Thread(() -> serve(client), "stream-proxy-client");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException e) {
                if (!socket.isClosed()) {
                    Log.w(TAG, "accept failed", e);
                }
            }
        }
    }

    private void serve(Socket client) {
        HttpURLConnection upstream = null;
        try (Socket socket = client) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), "ISO-8859-1"));
            String requestLine = reader.readLine();
            String range = null;
            for (String line = reader.readLine(); line != null && !line.isEmpty(); line = reader.readLine()) {
                if (line.regionMatches(true, 0, "Range:", 0, 6)) {
                    range = line.substring(6).trim();
                }
            }
            OutputStream out = socket.getOutputStream();
            String[] parts = requestLine == null ? new String[0] : requestLine.split(" ");
            String url = parts.length >= 2 && parts[1].startsWith("/s/") ? routes.get(parts[1].substring(3)) : null;
            if (url == null) {
                out.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".getBytes("ISO-8859-1"));
                return;
            }
            upstream = Http.open(context, url);
            upstream.setReadTimeout(60_000);
            // Navidrome's transcoded MP3 ignores ranges; Downtify's MP4 needs them, since MediaPlayer reads its index from the end.
            if (range != null) {
                upstream.setRequestProperty("Range", range);
            }
            int status = upstream.getResponseCode();
            String type = upstream.getContentType();
            if ((status != 200 && status != 206) || type == null || !type.startsWith("audio/")) {
                Log.w(TAG, "upstream answered " + status + " " + type);
                out.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".getBytes("ISO-8859-1"));
                return;
            }
            StringBuilder head = new StringBuilder(status == 206 ? "HTTP/1.1 206 Partial Content" : "HTTP/1.1 200 OK").append("\r\nContent-Type: ").append(type).append("\r\nConnection: close\r\n");
            long length = upstream.getContentLength();
            if (length > 0) {
                head.append("Content-Length: ").append(length).append("\r\n");
            }
            for (String name : new String[] {"Content-Range", "Accept-Ranges"}) {
                String value = upstream.getHeaderField(name);
                if (value != null) {
                    head.append(name).append(": ").append(value).append("\r\n");
                }
            }
            out.write(head.append("\r\n").toString().getBytes("ISO-8859-1"));
            if ("HEAD".equals(parts[0])) {
                return;
            }
            try (InputStream in = upstream.getInputStream()) {
                byte[] buffer = new byte[16 * 1024];
                for (int read; (read = in.read(buffer)) > 0; ) {
                    out.write(buffer, 0, read);
                }
            }
            out.flush();
        } catch (IOException e) {
            // MediaPlayer closes the connection whenever it skips or stops; that isn't an error.
            Log.d(TAG, "stream ended: " + e.getMessage());
        } finally {
            if (upstream != null) {
                upstream.disconnect();
            }
        }
    }
}
