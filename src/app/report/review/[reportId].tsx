import { useLocalSearchParams } from 'expo-router';

import { ReviewScreen } from '@/screens/ReviewScreen';

export default function ReviewRoute() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  return <ReviewScreen reportId={reportId} />;
}
