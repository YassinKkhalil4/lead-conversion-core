import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'rolefit.session.token';

/**
 * On native the opaque session token lives in the device keychain via
 * expo-secure-store.
 *
 * On web nothing is stored at all: the API sets an HttpOnly cookie, which
 * JavaScript cannot read and therefore cannot leak. The login response also
 * carries a token for native clients; on web it is deliberately discarded.
 */
export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A missing key is the desired end state anyway.
  }
}
