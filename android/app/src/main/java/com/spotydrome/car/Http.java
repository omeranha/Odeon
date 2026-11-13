package com.spotydrome.car;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

final class Http {

    static final class HttpException extends IOException {
        final int status;
        final String body;

        HttpException(int status, String body) {
            super(messageOf(status, body));
            this.status = status;
            this.body = body;
        }

        private static String messageOf(int status, String body) {
            try {
                String error = new JSONObject(body).optString("error", "");
                if (!error.isEmpty()) {
                    return error;
                }
            } catch (JSONException ignored) {
                // Not a JSON error body.
            }
            return "The server returned HTTP " + status;
        }
    }

    private Http() {
    }

    static HttpURLConnection open(Context context, String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        if (connection instanceof HttpsURLConnection) {
            ((HttpsURLConnection) connection).setSSLSocketFactory(Tls.socketFactory(context));
        }
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("User-Agent", "OdeonCar/" + BuildConfig.VERSION_NAME);
        return connection;
    }

    static JSONObject getJson(Context context, String url) throws IOException {
        return request(context, url, "GET", null, null);
    }

    static JSONObject postJson(Context context, String url, JSONObject body) throws IOException {
        return request(context, url, "POST", body == null ? new JSONObject() : body, null);
    }

    static JSONObject request(Context context, String url, String method, JSONObject body, Map<String, String> headers) throws IOException {
        return request(context, url, method, body, headers, 30_000);
    }

    static JSONObject request(Context context, String url, String method, JSONObject body, Map<String, String> headers, int readTimeoutMs) throws IOException {
        HttpURLConnection connection = open(context, url);
        try {
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Accept", "application/json");
            if (headers != null) {
                for (Map.Entry<String, String> header : headers.entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }
            connection.setRequestMethod(method);
            if (body != null) {
                byte[] bytes = body.toString().getBytes("UTF-8");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            String text = readAll(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            if (status >= 400) {
                throw new HttpException(status, text);
            }
            if (status == 204 || text.isEmpty()) {
                return new JSONObject();
            }
            JSONObject json = new JSONObject(text);
            json.put("_status", status);
            return json;
        } catch (JSONException e) {
            throw new IOException("The server sent an unreadable response", e);
        } finally {
            connection.disconnect();
        }
    }

    static String readAll(InputStream in) throws IOException {
        if (in == null) {
            return "";
        }
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read; (read = stream.read(buffer)) > 0; ) {
                out.write(buffer, 0, read);
            }
            return out.toString("UTF-8");
        }
    }
}
