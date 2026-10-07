import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CATEGORY_INFO } from '@/constants/categories';
import { colors, HIT_TARGET, radius, space } from '@/constants/theme';
import { ISSUE_CATEGORIES, type IssueCategory } from '@/models/issue';

import { tapFeedback } from './Button';
import { Icon } from './Icon';
import { T } from './Typography';

export const ToggleRow = ({
  label,
  description,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) => (
  <View style={[styles.toggleRow, disabled && styles.dim]}>
    <View style={styles.flex}>
      <T variant="bodyMedium">{label}</T>
      {description ? (
        <T variant="callout" tone="secondary">
          {description}
        </T>
      ) : null}
      {disabled && disabledReason ? (
        <T variant="caption" tone="caution">
          {disabledReason}
        </T>
      ) : null}
    </View>
    <Switch
      value={value}
      onValueChange={(v) => {
        tapFeedback();
        onChange(v);
      }}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={description}
      trackColor={{ true: colors.accent, false: colors.surfacePressed }}
      thumbColor={colors.white}
    />
  </View>
);

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export const ChipGroup = <V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly ChipOption<V>[];
  value: V | undefined;
  onChange: (v: V) => void;
  accessibilityLabel: string;
}) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={accessibilityLabel}>
    {options.map((o) => {
      const selected = o.value === value;
      return (
        <Pressable
          key={o.value}
          onPress={() => {
            tapFeedback();
            onChange(o.value);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`${o.label}${selected ? ', selected' : ''}`}
          style={[styles.chip, selected && styles.chipSelected]}
        >
          <T variant="caption" style={{ color: selected ? colors.textInverse : colors.textSecondary }}>
            {o.label}
          </T>
        </Pressable>
      );
    })}
  </ScrollView>
);

export const Segmented = <V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly ChipOption<V>[];
  value: V | undefined;
  onChange: (v: V) => void;
  accessibilityLabel: string;
}) => (
  <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
    {options.map((o) => {
      const selected = o.value === value;
      return (
        <Pressable
          key={o.value}
          onPress={() => {
            tapFeedback();
            onChange(o.value);
          }}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={o.label}
          style={[styles.segment, selected && styles.segmentSelected]}
        >
          <T variant="bodyMedium" style={{ color: selected ? colors.text : colors.textSecondary }}>
            {o.label}
          </T>
        </Pressable>
      );
    })}
  </View>
);

export const Checkbox = ({ checked, onChange, label, children }: { checked: boolean; onChange: (v: boolean) => void; label: string; children?: ReactNode }) => (
  <Pressable
    onPress={() => {
      tapFeedback();
      onChange(!checked);
    }}
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
    accessibilityLabel={label}
    style={styles.checkRow}
  >
    <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Icon name="check" size={16} color={colors.textInverse} strokeWidth={3} /> : null}</View>
    <View style={styles.flex}>
      <T variant="bodyMedium">{label}</T>
      {children}
    </View>
  </Pressable>
);

/** Full-screen sheet to choose an issue type (user always has the final say). */
export const CategoryPicker = ({
  visible,
  selected,
  suggested,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected?: IssueCategory;
  suggested?: readonly IssueCategory[];
  onSelect: (c: IssueCategory) => void;
  onClose: () => void;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.sheetHeader}>
            <T variant="headline" accessibilityRole="header">
              Choose the issue type
            </T>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Icon name="close" />
            </Pressable>
          </View>
          <ScrollView>
            {ISSUE_CATEGORIES.map((c) => {
              const info = CATEGORY_INFO[c];
              const isSel = c === selected;
              const isSuggested = suggested?.includes(c);
              return (
                <Pressable
                  key={c}
                  onPress={() => {
                    tapFeedback();
                    onSelect(c);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={`${info.label}${isSuggested ? ', suggested by CivicLens' : ''}`}
                  style={({ pressed }) => [styles.catRow, pressed && { backgroundColor: colors.surfacePressed }]}
                >
                  <View style={styles.catIcon}>
                    <Icon name={info.icon} size={20} color={isSel ? colors.accent : colors.textSecondary} />
                  </View>
                  <View style={styles.flex}>
                    <T variant="bodyMedium" style={isSel ? { color: colors.accent } : undefined}>
                      {info.label}
                    </T>
                    <T variant="caption" tone="tertiary" numberOfLines={2}>
                      {info.looksFor}
                    </T>
                  </View>
                  {isSuggested ? (
                    <T variant="caption" tone="accent">
                      Suggested
                    </T>
                  ) : null}
                  {isSel ? <Icon name="check" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  dim: { opacity: 0.6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: HIT_TARGET },
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    paddingHorizontal: space.md,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: colors.surfacePressed },
  checkRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.sm, minHeight: HIT_TARGET },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.lg, paddingVertical: space.sm },
  close: { width: HIT_TARGET, height: HIT_TARGET, alignItems: 'center', justifyContent: 'center' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  catIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
});
