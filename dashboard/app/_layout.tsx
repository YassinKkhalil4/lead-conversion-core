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
import { ScreenErrorBoundary } from '@/nav/ErrorBoundary';
import { Shell } from '@/nav/Shell';
import { clearPersistedCache, persister, queryClient } from '@/query/client';

const WEEK = 1000 * 60 * 60 * 24 * 7;

/**
 * The focus ring, and the only place besides the mark where the brand green
 * appears. It is the deep green rather than the bright one: #007A47 reaches
 * 5.22:1 on paper, where #00B368 manages 2.63:1 and would leave a keyboard
 * user guessing where they are.
 *
 * React Native has no focus-ring primitive, so on web this is a stylesheet.
 * `:focus-visible` keeps it off pointer interactions and on keyboard ones,
 * which is what the browser default already did — this only recolours it.
 */
const FOCUS_RING_CSS = `
:focus-visible {
  outline: 2px solid ${color.accent};
  outline-offset: 3px;
  border-radius: 2px;
}
`;

/**
 * The tab icon, inline rather than an asset. Same artwork as
 * `landing/assets/kadensio-icon.svg`.
 *
 * `expo.web.favicon` runs the file through a rasteriser that rejects SVG, and
 * the brand ships no raster logo and asks that none be made. A data URI keeps
 * the mark vector and costs one request less than a file would.
 *
 * This is the two-chevron small icon, which is the brand's only sanctioned
 * simplification: below about 24px the three-chevron mark's faded strokes merge
 * into a smudge, and a favicon is 16.
 */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#0C1F1A"/>' +
    '<g fill="none" stroke-linecap="round" stroke-width="7" ' +
    'transform="translate(32 32) scale(0.78) translate(-32 -32)">' +
    '<path d="M17 16 V48" stroke="#FFFFFF"/>' +
    '<path d="M29 30 L47 14" stroke="#FFFFFF"/>' +
    '<path d="M29 34 L47 50" stroke="#00B368"/>' +
    '</g></svg>',
)}`;

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
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.dataset.kadensio = 'focus-ring';
    style.textContent = FOCUS_RING_CSS;
    document.head.appendChild(style);

    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = FAVICON;
    document.head.appendChild(icon);

    return () => {
      style.remove();
      icon.remove();
    };
  }, []);

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
          {/* One shell instance around every authenticated route, so moving
              between surfaces does not remount the navigation. */}
          <Shell>
            {/* Inside the shell, so a screen that fails to render leaves the
                navigation in place to move away with. */}
            <ScreenErrorBoundary onReset={() => void clearPersistedCache()}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: color.tint },
                }}
              />
            </ScreenErrorBoundary>
          </Shell>
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
