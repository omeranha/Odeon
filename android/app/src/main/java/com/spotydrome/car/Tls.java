package com.spotydrome.car;

import android.content.Context;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

// Android 4.2 doesn't trust Let's Encrypt's or Google's current roots and leaves TLS 1.1/1.2 switched off,
// so connections use bundled roots (plus the system ones) and a socket factory that turns the newer protocols on.
final class Tls {

    private static final int[] ROOTS = {R.raw.isrg_root_x1, R.raw.isrg_root_x2, R.raw.isrg_root_ye, R.raw.isrg_root_yr, R.raw.gts_root_r1, R.raw.gts_root_r4, R.raw.sslcom_root_ecc, R.raw.sslcom_root_rsa};
    private static final String[] PROTOCOLS = {"TLSv1.2", "TLSv1.1", "TLSv1"};

    private static SSLSocketFactory factory;

    private Tls() {
    }

    static synchronized SSLSocketFactory socketFactory(Context context) {
        if (factory == null) {
            try {
                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, new TrustManager[] {new CombinedTrustManager(bundledTrust(context), systemTrust())}, null);
                factory = new ModernProtocols(ssl.getSocketFactory());
            } catch (Exception e) {
                throw new IllegalStateException("TLS setup failed", e);
            }
        }
        return factory;
    }

    private static X509TrustManager bundledTrust(Context context) throws Exception {
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null, null);
        CertificateFactory certificates = CertificateFactory.getInstance("X.509");
        for (int id : ROOTS) {
            try (InputStream in = context.getResources().openRawResource(id)) {
                store.setCertificateEntry("root-" + id, certificates.generateCertificate(in));
            }
        }
        return trustManagerFor(store);
    }

    private static X509TrustManager systemTrust() throws Exception {
        return trustManagerFor(null);
    }

    private static X509TrustManager trustManagerFor(KeyStore store) throws Exception {
        TrustManagerFactory managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        managers.init(store);
        for (TrustManager manager : managers.getTrustManagers()) {
            if (manager instanceof X509TrustManager) {
                return (X509TrustManager) manager;
            }
        }
        throw new IllegalStateException("No X509TrustManager");
    }

    private static final class CombinedTrustManager implements X509TrustManager {
        private final X509TrustManager bundled;
        private final X509TrustManager system;

        CombinedTrustManager(X509TrustManager bundled, X509TrustManager system) {
            this.bundled = bundled;
            this.system = system;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            system.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            try {
                bundled.checkServerTrusted(chain, authType);
            } catch (CertificateException bundledFailure) {
                system.checkServerTrusted(chain, authType);
            }
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            List<X509Certificate> all = new ArrayList<>(Arrays.asList(bundled.getAcceptedIssuers()));
            all.addAll(Arrays.asList(system.getAcceptedIssuers()));
            return all.toArray(new X509Certificate[0]);
        }
    }

    private static final class ModernProtocols extends SSLSocketFactory {
        private final SSLSocketFactory delegate;

        ModernProtocols(SSLSocketFactory delegate) {
            this.delegate = delegate;
        }

        private Socket upgrade(Socket socket, String host) {
            if (socket instanceof SSLSocket) {
                SSLSocket ssl = (SSLSocket) socket;
                List<String> supported = Arrays.asList(ssl.getSupportedProtocols());
                List<String> enabled = new ArrayList<>();
                for (String protocol : PROTOCOLS) {
                    if (supported.contains(protocol)) {
                        enabled.add(protocol);
                    }
                }
                ssl.setEnabledProtocols(enabled.toArray(new String[0]));
                ssl.setEnabledCipherSuites(preferredCiphers(ssl.getSupportedCipherSuites()));
                if (host != null) {
                    setServerName(ssl, host);
                }
            }
            return socket;
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return delegate.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return delegate.getSupportedCipherSuites();
        }

        @Override
        public Socket createSocket(Socket socket, String host, int port, boolean autoClose) throws java.io.IOException {
            return upgrade(delegate.createSocket(socket, host, port, autoClose), host);
        }

        @Override
        public Socket createSocket(String host, int port) throws java.io.IOException {
            return upgrade(delegate.createSocket(host, port), host);
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws java.io.IOException {
            return upgrade(delegate.createSocket(host, port, localHost, localPort), host);
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws java.io.IOException {
            return upgrade(delegate.createSocket(host, port), null);
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws java.io.IOException {
            return upgrade(delegate.createSocket(address, port, localAddress, localPort), null);
        }
    }

    // Cloudflare refuses handshakes without SNI, and Android 4.2 only exposes it through the hidden OpenSSLSocketImpl.setHostname.
    private static void setServerName(SSLSocket socket, String host) {
        try {
            socket.getClass().getMethod("setHostname", String.class).invoke(socket, host);
        } catch (Exception ignored) {
            // Not the OpenSSL implementation; HttpsURLConnection sets SNI itself in that case.
        }
    }

    private static String[] preferredCiphers(String[] supported) {
        List<String> strong = new ArrayList<>();
        List<String> fallback = new ArrayList<>();
        for (String suite : supported) {
            if (suite.contains("_anon_") || suite.contains("_NULL_") || suite.contains("_EXPORT_") || suite.contains("_RC4_") || suite.contains("_DES_") || suite.contains("_MD5")) {
                continue;
            }
            if (suite.startsWith("TLS_ECDHE_")) {
                strong.add(suite);
            } else {
                fallback.add(suite);
            }
        }
        strong.addAll(fallback);
        return strong.toArray(new String[0]);
    }

    static String describe(Context context) {
        try {
            SSLSocket socket = (SSLSocket) socketFactory(context).createSocket();
            String text = "protocols " + Arrays.toString(socket.getSupportedProtocols()) + "\nciphers " + Arrays.toString(socket.getSupportedCipherSuites());
            socket.close();
            return text;
        } catch (Exception e) {
            return "describe failed " + e;
        }
    }
}
