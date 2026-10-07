import { useLocalSearchParams } from 'expo-router';

import { ReportScreen } from '@/screens/ReportScreen';

export default function ReportRoute() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  return <ReportScreen reportId={reportId} />;
}
