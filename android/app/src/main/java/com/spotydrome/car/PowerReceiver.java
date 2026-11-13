package com.spotydrome.car;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

// In the car, power follows the ignition: losing it pauses, getting it back resumes what was playing.
public final class PowerReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Prefs prefs = new Prefs(context);
        String action = intent.getAction();
        if (Intent.ACTION_POWER_DISCONNECTED.equals(action)) {
            if (prefs.pauseOnPowerLoss()) {
                PlayerService.powerLost(context);
            }
            return;
        }
        boolean powered = Intent.ACTION_POWER_CONNECTED.equals(action) || isCharging(context);
        if (powered && prefs.resumeOnPower() && prefs.wasPlaying() && prefs.signedIn()) {
            PlayerService.resumeSaved(context);
        }
    }

    private static boolean isCharging(Context context) {
        Intent battery = context.getApplicationContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        return battery != null && battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
    }
}
