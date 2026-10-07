import { useLocalSearchParams } from 'expo-router';

import { IssueDetailScreen } from '@/screens/IssueDetailScreen';

export default function IssueRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <IssueDetailScreen id={id} />;
}
