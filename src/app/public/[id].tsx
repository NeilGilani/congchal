import { useLocalSearchParams } from 'expo-router';

import { PublicReportScreen } from '@/screens/PublicReportScreen';

export default function PublicReportRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PublicReportScreen id={id} />;
}
