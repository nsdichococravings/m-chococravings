import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // ─────────────────────────────────────────────
  //  APP IDENTITY
  //  appId must be unique — never change after publishing!
  // ─────────────────────────────────────────────
  appId: 'com.nsdi.chococravings',
  appName: 'ChocoCravings',
  webDir: 'public',

  // ─────────────────────────────────────────────
  //  SERVER — for local dev live reload
  //  Remove "url" line before building for store!
  // ─────────────────────────────────────────────
  // server: {
  //   url: 'http://192.168.1.x:3000',
  //   cleartext: true,
  // },

  // ─────────────────────────────────────────────
  //  PLUGINS
  // ─────────────────────────────────────────────
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: '#09010F',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#6B2FCE',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',              // dark icons on light, light icons on dark
      backgroundColor: '#09010F',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },

  // ─────────────────────────────────────────────
  //  ANDROID SPECIFIC
  // ─────────────────────────────────────────────
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,     // set true for dev, false for prod
    loggingBehavior: 'none',               // 'debug' for dev, 'none' for prod
    backgroundColor: '#09010F',
  },

  // ─────────────────────────────────────────────
  //  IOS SPECIFIC
  // ─────────────────────────────────────────────
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#09010F',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
};

export default config;
