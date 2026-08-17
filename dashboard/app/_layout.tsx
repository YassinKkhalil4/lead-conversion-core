import { useEffect } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth/AuthProvider';
import { color } from '@/design/tokens';
import { persister, queryClient } from '@/query/client';

const WEEK = 1000 * 60 * 60 * 24 * 7;

// Real connectivity, not an assumption. Without this the query client treats a
// native device as permanently online and queued actions never pause.
if (Platform.OS !== 'web') {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    }),
  );
}

export default function RootLayout() {
  useEffect(() => {
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) void queryClient.resumePausedMutations();
    });
    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: WEEK }}
        onSuccess={() => {
          // Replays acknowledgements captured while offline, including across
          // an app restart.
          void queryClient.resumePausedMutations();
        }}
      >
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.paper },
            }}
          />
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
