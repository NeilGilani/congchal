import { useNetworkState } from 'expo-network';

/** `offline` only when the OS says there is no connection; unknown counts as online. */
export const useIsOffline = (): boolean => {
  const state = useNetworkState();
  return state.isConnected === false || state.isInternetReachable === false;
};
