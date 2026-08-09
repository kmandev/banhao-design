import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  SectionHeader,
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

const STARS = [1, 2, 3, 4, 5];

/**
 * 15 ให้คะแนน.
 *
 * The rating is local only — no submission endpoint exists yet (brief §7).
 */
export function RatingScreen() {
  const navigation = useNavigation<Nav>();
  const [shopRating, setShopRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [comment, setComment] = useState('');

  const canSubmit = shopRating > 0;

  return (
    <Screen
      scroll
      testID="screen-rating"
      footer={
        <BottomBar>
          <Button
            label="ส่งคะแนน"
            disabled={!canSubmit}
            onPress={() => navigation.navigate('Tabs')}
            testID="button-submit-rating"
          />
          <Button label="ข้ามไปก่อน" variant="ghost" onPress={() => navigation.navigate('Tabs')} />
        </BottomBar>
      }
    >
      <SectionHeader title="ให้คะแนนออเดอร์นี้" />

      <Card style={styles.block}>
        <Text style={styles.label}>ร้านอาหาร</Text>
        <StarRow value={shopRating} onChange={setShopRating} testID="stars-shop" />
      </Card>

      <Card style={styles.block}>
        <Text style={styles.label}>ไรเดอร์</Text>
        <StarRow value={driverRating} onChange={setDriverRating} testID="stars-driver" />
      </Card>

      <Card style={styles.block}>
        <Text style={styles.label}>ความคิดเห็นเพิ่มเติม</Text>
        <TextInput
          style={styles.comment}
          placeholder="บอกเราหน่อยว่าเป็นอย่างไรบ้าง"
          placeholderTextColor={colors.textFaint}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={300}
          accessibilityLabel="ความคิดเห็นเพิ่มเติม"
        />
      </Card>
    </Screen>
  );
}

function StarRow({
  value,
  onChange,
  testID,
}: {
  value: number;
  onChange: (v: number) => void;
  testID?: string;
}) {
  return (
    <View style={styles.starRow} testID={testID}>
      {STARS.map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star)}
          accessibilityRole="button"
          accessibilityLabel={`ให้ ${star} ดาว`}
          accessibilityState={{ selected: value >= star }}
          style={styles.star}
        >
          <Text style={styles.starGlyph}>{value >= star ? '⭐' : '☆'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  label: { fontSize: fontSize.xxl, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  starRow: { flexDirection: 'row', gap: spacing.sm },
  star: { padding: spacing.xs, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  starGlyph: { fontSize: 32 },
  comment: {
    minHeight: 96,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
});
