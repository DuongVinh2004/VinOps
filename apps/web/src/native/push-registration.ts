import { Capacitor } from '@capacitor/core';

export interface PushRegistrationResult {
  registered: boolean;
  platform: 'android_fcm' | 'ios_apns' | 'web_push';
  deviceToken?: string | undefined;
  error?: string | undefined;
}

export interface RegisterDeviceApiPayload {
  platform: 'android_fcm' | 'ios_apns' | 'web_push';
  deviceToken: string;
  deviceName?: string | undefined;
  deviceModel?: string | undefined;
  appVersion?: string | undefined;
  osVersion?: string | undefined;
}

export interface PushRegistrationOptions {
  apiBaseUrl: string;
  authToken: string;
  onNotificationReceived?: ((notification: unknown) => void) | undefined;
  onNotificationActionPerformed?: ((action: unknown) => void) | undefined;
}

export async function sendDeviceTokenToApi(
  apiBaseUrl: string,
  authToken: string,
  payload: RegisterDeviceApiPayload,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const normalizedBase = apiBaseUrl.replace(/\/+$/u, '');
  const url = normalizedBase.includes('/api/v1')
    ? `${normalizedBase}/users/me/devices`
    : `${normalizedBase}/api/v1/users/me/devices`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Server rejected token (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as unknown;
    return {
      success: true,
      data,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

export async function initializePushNotifications(
  options: PushRegistrationOptions,
): Promise<PushRegistrationResult> {
  const isNative = Capacitor.isNativePlatform();
  const rawPlatform = Capacitor.getPlatform();
  const platform: 'android_fcm' | 'ios_apns' | 'web_push' =
    rawPlatform === 'ios' ? 'ios_apns' : rawPlatform === 'android' ? 'android_fcm' : 'web_push';

  if (!isNative) {
    return {
      registered: false,
      platform,
      error: 'Push notifications are only supported on native devices',
    };
  }

  // Use dynamic access to PushNotifications plugin
  const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
  const PushNotifications = (plugins?.['PushNotifications'] ??
    (window as unknown as { PushNotifications?: unknown }).PushNotifications) as
    | {
        checkPermissions?: () => Promise<{ receive: string }>;
        requestPermissions?: () => Promise<{ receive: string }>;
        register?: () => Promise<void>;
        addListener?: (event: string, callback: (...args: unknown[]) => void) => void;
      }
    | undefined;

  if (!PushNotifications) {
    return {
      registered: false,
      platform,
      error: 'PushNotifications plugin is not available on this platform',
    };
  }

  try {
    let permStatus = PushNotifications.checkPermissions
      ? await PushNotifications.checkPermissions()
      : { receive: 'prompt' };

    if (permStatus.receive === 'prompt' && PushNotifications.requestPermissions) {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      return {
        registered: false,
        platform,
        error: 'Push notification permission denied by user',
      };
    }

    // Return promise resolved when token is delivered via listener
    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
        resolve({
          registered: false,
          platform,
          error: 'Registration timed out waiting for token',
        });
      }, 10000);

      if (PushNotifications.addListener) {
        PushNotifications.addListener('registration', (tokenObj: unknown) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          const tokenStr =
            typeof tokenObj === 'string' ? tokenObj : (tokenObj as { value?: string })?.value;

          if (tokenStr) {
            void sendDeviceTokenToApi(options.apiBaseUrl, options.authToken, {
              platform,
              deviceToken: tokenStr,
              osVersion: rawPlatform,
            }).then(() => {
              resolve({
                registered: true,
                platform,
                deviceToken: tokenStr,
              });
            });
          } else {
            resolve({
              registered: false,
              platform,
              error: 'No token value received in registration event',
            });
          }
        });

        PushNotifications.addListener('registrationError', (error: unknown) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          resolve({
            registered: false,
            platform,
            error: String(error),
          });
        });

        if (options.onNotificationReceived) {
          PushNotifications.addListener('pushNotificationReceived', options.onNotificationReceived);
        }

        if (options.onNotificationActionPerformed) {
          PushNotifications.addListener(
            'pushNotificationActionPerformed',
            options.onNotificationActionPerformed,
          );
        }
      }

      if (PushNotifications.register) {
        void PushNotifications.register();
      }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      registered: false,
      platform,
      error: errorMsg,
    };
  }
}
