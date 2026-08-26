import { Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import type { RiderStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RiderStackParamList>;
type Route = RouteProp<RiderStackParamList, 'ProofReview'>;

/**
 * P-05 ตรวจรูปก่อนยืนยัน — the review screen (POD UX design §C).
 *
 * **Nothing is uploaded from here.** `ใช้รูปนี้` advances to the confirm
 * screen and does not deliver anything; the upload begins only when the rider
 * presses ส่งสำเร็จ there. Keeping capture, review and submission as three
 * distinct acts is what makes an abandoned attempt cost nothing — no object in
 * R2, no row, no state moved.
 *
 * ## Why this screen exists at all
 *
 * It is the privacy control. Automatic face detection or blurring is
 * deliberately not implemented — it would be a new capability, an accuracy
 * claim, and a false sense of safety. Instead the rider looks at the photo and
 * retakes it, freely and unlimited, before confirmation. The review copy asks
 * whether the drop point is clear, which is the question that also catches a
 * person who wandered into frame.
 *
 * `ถ่ายใหม่` replaces this screen with the camera rather than pushing another
 * one, so a rider who retakes five times has a stack one level deep, not five.
 */
export function ProofReviewScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { deliveryId, photo } = params;

  return (
    <View style={styles.screen} testID="screen-proof-review">
      <Text style={styles.title}>ตรวจรูปก่อนยืนยัน</Text>

      <View style={styles.frame}>
        <Image
          source={{ uri: photo.uri }}
          style={styles.preview}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`รูปหลักฐานการส่ง ถ่ายเมื่อ ${formatTime(photo.capturedAt)}`}
          testID="proof-preview"
        />
      </View>

      <Text style={styles.caption} testID="proof-captured-at">
        ถ่ายเมื่อ {formatTime(photo.capturedAt)}
      </Text>
      <Text style={styles.question}>เห็นอาหารและจุดวางชัดเจนไหม ถ้าไม่ชัด ถ่ายใหม่ได้</Text>

      <View style={styles.actions}>
        <Button
          label="ถ่ายใหม่"
          variant="secondary"
          onPress={() => navigation.replace('ProofCamera', { deliveryId })}
          testID="button-retake"
        />
        <Button
          label="ใช้รูปนี้"
          onPress={() => navigation.replace('DeliveryConfirm', { deliveryId, photo })}
          testID="button-use-photo"
        />
      </View>
    </View>
  );
}

/**
 * Absolute local time — the same convention every other screen in this app
 * uses (DQ-G7-03): no relative "N นาทีที่แล้ว" that would imply a freshness
 * judgement nothing here makes.
 */
function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString('th-TH');
}

const DARK_GROUND = '#141210';
const DARK_TEXT = '#FFFFFF';
const DARK_TEXT_MUTED = 'rgba(255,255,255,0.78)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DARK_GROUND, padding: spacing.lg, gap: spacing.md },
  title: {
    color: DARK_TEXT,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.h2,
    paddingTop: spacing.xxl,
  },
  frame: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  preview: { flex: 1, width: '100%' },
  caption: { color: DARK_TEXT_MUTED, fontFamily: fontFamily.regular, fontSize: fontSize.md },
  question: { color: DARK_TEXT, fontFamily: fontFamily.regular, fontSize: fontSize.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
});

export const proofReviewAccent = colors.primary;
