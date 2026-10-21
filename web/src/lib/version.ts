declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** "1.0.0" for a release build, "1.0.0 (abc1234)" for any other commit, "1.2.0 (dev)" locally. */
export const appVersion =
  __APP_BUILD__ === __APP_VERSION__ ? __APP_VERSION__ : `${__APP_VERSION__} (${__APP_BUILD__})`;
