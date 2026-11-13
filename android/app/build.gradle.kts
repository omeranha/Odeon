import java.util.Properties

plugins {
    id("com.android.application")
}

val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

android {
    namespace = "com.spotydrome.car"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.spotydrome.car"
        minSdk = 17
        targetSdk = 17
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SERVER", "\"${localProperties.getProperty("odeon.server", "https://your-server.example")}\"")
        vectorDrawables {
            generatedDensities("ldpi", "mdpi", "hdpi", "xhdpi")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi")
    }
}
