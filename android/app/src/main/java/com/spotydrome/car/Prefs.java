package com.spotydrome.car;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;
import java.util.Locale;

final class Prefs {

    static final String SERVER = BuildConfig.SERVER;
    static final int[] BITRATES = {96, 128, 192, 320};

    private final Context context;
    private final SharedPreferences prefs;

    Prefs(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("spotydrome", Context.MODE_PRIVATE);
    }

    boolean signedIn() {
        return !username().isEmpty() && !token().isEmpty();
    }

    String username() {
        return prefs.getString("username", "");
    }

    String displayName() {
        return prefs.getString("displayName", username());
    }

    String token() {
        return prefs.getString("token", "");
    }

    String salt() {
        return prefs.getString("salt", "");
    }

    void saveSession(String username, String displayName, String token, String salt) {
        prefs.edit().putString("username", username).putString("displayName", displayName).putString("token", token).putString("salt", salt).apply();
    }

    void clearSession() {
        prefs.edit().remove("username").remove("displayName").remove("token").remove("salt").apply();
    }

    // Identifies this tablet to the user's other devices; random, so it says nothing about the hardware.
    String deviceId() {
        String id = prefs.getString("deviceId", "");
        if (id.isEmpty()) {
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte value : bytes) {
                hex.append(String.format(Locale.ROOT, "%02x", value));
            }
            id = hex.toString();
            prefs.edit().putString("deviceId", id).apply();
        }
        return id;
    }

    int streamBitrate() {
        return prefs.getInt("streamBitrate", 128);
    }

    void setStreamBitrate(int bitrate) {
        prefs.edit().putInt("streamBitrate", bitrate).apply();
    }

    int downloadBitrate() {
        return prefs.getInt("downloadBitrate", 192);
    }

    void setDownloadBitrate(int bitrate) {
        prefs.edit().putInt("downloadBitrate", bitrate).apply();
    }

    boolean offlineOnly() {
        return prefs.getBoolean("offlineOnly", false);
    }

    void setOfflineOnly(boolean value) {
        prefs.edit().putBoolean("offlineOnly", value).apply();
    }

    boolean resumeOnPower() {
        return prefs.getBoolean("resumeOnPower", true);
    }

    void setResumeOnPower(boolean value) {
        prefs.edit().putBoolean("resumeOnPower", value).apply();
    }

    boolean pauseOnPowerLoss() {
        return prefs.getBoolean("pauseOnPowerLoss", true);
    }

    void setPauseOnPowerLoss(boolean value) {
        prefs.edit().putBoolean("pauseOnPowerLoss", value).apply();
    }

    boolean flipScreen() {
        if (!prefs.contains("flipScreen")) {
            prefs.edit().putBoolean("flipScreen", Orientation.systemPinnedUpsideDown(context)).apply();
        }
        return prefs.getBoolean("flipScreen", false);
    }

    void setFlipScreen(boolean value) {
        prefs.edit().putBoolean("flipScreen", value).apply();
    }

    boolean useExternalSd() {
        return prefs.getBoolean("useExternalSd", true);
    }

    void setUseExternalSd(boolean value) {
        prefs.edit().putBoolean("useExternalSd", value).apply();
    }

    // Set while music plays, cleared on a deliberate pause, so power-on only resumes what the power cut interrupted.
    boolean wasPlaying() {
        return prefs.getBoolean("wasPlaying", false);
    }

    void setWasPlaying(boolean value) {
        prefs.edit().putBoolean("wasPlaying", value).apply();
    }
}
