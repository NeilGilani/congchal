import { useLocalSearchParams } from 'expo-router';

import { ResultScreen } from '@/screens/ResultScreen';

export default function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return <ResultScreen scanId={scanId} />;
}
