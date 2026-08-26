import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import { prepareProofPhoto, ProofPhotoInvalidError } from '../lib/proofPhoto';
import type { RiderStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RiderStackParamList>;
type Route = RouteProp<RiderStackParamList, 'ProofCamera'>;

/**
 * P-03 / P-04 / P-10 — the permission rationale, the viewfinder, and the
 * blocked state, in one route (POD UX design §C).
 *
 * Three screens in the design, one component here, because they are three
 * renderings of a single question — *can this rider take a photo right now* —
 * whose answer is the permission hook's own state. Splitting them into routes
 * would mean pushing and popping in response to a permission callback, which
 * is exactly the kind of navigation a rider can get stranded inside.
 *
 * ## The permission is asked when the rider asks for it
 *
 * Never on mount. P-03 states what the camera is for, what it is *not* for,
 * and who sees the photo, and only `อนุญาตใช้กล้อง` triggers the real OS
 * prompt. A rider who has no reason to say yes yet is never asked.
 *
 * ## Privacy is in what the UI asks for
 *
 * The guidance names the subject — the food at the drop point — and states the
 * exclusions in the same breath: `ไม่ต้องถ่ายหน้าลูกค้า ไม่ต้องถ่ายบัตรหรือ
 * เอกสาร`. Nothing in this flow requests a face, an ID, a phone number or a
 * house number. There is no gallery picker: a photo imported from the library
 * could have been taken anywhere, at any time, by anyone, which is the
 * opposite of evidence.
 *
 * ## No automatic quality judgement
 *
 * No blur detection, no face detection, no quality score. Each would be an
 * accuracy claim this app cannot back, and the review screen already asks the
 * question that catches both a bad photo and a person in frame. What *is*
 * validated is mechanical and certain: the file exists, is non-empty, and
 * survives re-encoding (`prepareProofPhoto`).
 */
export function ProofCameraScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);

  // The permission hook has not resolved yet — not the same as "denied", and
  // must not render as it.
  if (!permission) {
    return (
      <View style={styles.dark} testID="proof-camera-initialising">
        <ActivityIndicator color={colors.surface} />
      </View>
    );
  }

  // P-03 — the rationale, shown before the OS prompt has ever appeared.
  if (!permission.granted && permission.canAskAgain) {
    return (
      <View style={styles.rationale} testID="proof-camera-rationale">
        <Text style={styles.rationaleTitle}>ขออนุญาตใช้กล้อง</Text>
        <Text style={styles.rationaleBody}>
          BANHAO ใช้กล้องเพื่อถ่ายรูปหลักฐานการส่งเท่านั้น ระบบไม่เปิดกล้องเองและไม่ถ่ายรูปโดยที่คุณไม่ได้กด
        </Text>
        <Text style={styles.rationaleBullet}>· รูปถูกส่งไปเก็บที่ระบบ ไม่ได้เก็บในคลังรูปของเครื่อง</Text>
        <Text style={styles.rationaleBullet}>· ลูกค้าเห็นรูปนี้ในรายละเอียดออเดอร์ของตัวเอง</Text>
        <Text style={styles.rationaleBullet}>· คุณถ่ายใหม่ได้ก่อนกดยืนยัน</Text>

        <Button
          label="อนุญาตใช้กล้อง"
          onPress={() => void requestPermission()}
          testID="button-request-camera-permission"
        />
        <Button
          label="ไม่ใช่ตอนนี้"
          variant="secondary"
          onPress={() => navigation.goBack()}
          testID="button-decline-camera-permission"
        />
      </View>
    );
  }

  // P-10 — permanently denied. The job stays open; there is deliberately no
  // completion path without a photo (DEC-038), so this screen offers a route
  // to settings and a route to a human, and never a way to close the delivery.
  if (!permission.granted) {
    return (
      <View style={styles.rationale} testID="proof-camera-blocked">
        <Text style={styles.blockedMark}>🚫</Text>
        <Text style={styles.rationaleTitle}>แอปยังไม่ได้รับอนุญาตใช้กล้อง</Text>
        <Text style={styles.rationaleBody}>
          เปิดสิทธิ์กล้องในตั้งค่าของเครื่อง แล้วกลับมาถ่ายรูปหลักฐาน
        </Text>
        <Text style={styles.rationaleBullet}>ตั้งค่า › BANHAO Driver › กล้อง</Text>

        <Button
          label="เปิดตั้งค่า"
          onPress={() => void Linking.openSettings()}
          testID="button-open-settings"
        />
        <Button
          label="กลับไปหน้างาน"
          variant="secondary"
          onPress={() => navigation.goBack()}
          testID="button-back-from-blocked"
        />
        <Text style={styles.rationaleFootnote}>
          งานนี้ยังไม่ปิด และยังอยู่ในรายการงานของคุณ · ถ้าถ่ายรูปไม่ได้จริง ๆ ให้ติดต่อผู้ดูแล
        </Text>
      </View>
    );
  }

  const capture = async () => {
    if (capturing) return;
    setCapturing(true);
    setCaptureError(null);

    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1, exif: false });
      if (!shot?.uri) {
        throw new ProofPhotoInvalidError('ถ่ายไม่สำเร็จ ลองอีกครั้ง');
      }

      // Resize, re-encode and validate before leaving this screen. A
      // zero-byte or unreadable capture never reaches review, and the
      // re-encode is also what drops any EXIF the camera attached.
      const photo = await prepareProofPhoto(shot.uri);

      navigation.replace('ProofReview', { deliveryId: params.deliveryId, photo });
    } catch (cause) {
      // The camera stays open — one inline line, and the shutter is live
      // again. Never a dialog, never a navigation away from the viewfinder.
      setCaptureError(
        cause instanceof ProofPhotoInvalidError ? cause.message : 'ถ่ายไม่สำเร็จ ลองอีกครั้ง',
      );
    } finally {
      setCapturing(false);
    }
  };

  // P-04 — the viewfinder.
  return (
    <View style={styles.dark} testID="proof-camera">
      <CameraView ref={cameraRef} style={styles.viewfinder} facing="back" />

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="ยกเลิก"
          testID="button-cancel-camera"
          style={styles.iconButton}
        >
          <Text style={styles.iconGlyph}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>ถ่ายรูปหลักฐาน</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.guidance}>
        <Text style={styles.guidanceTitle}>ถ่ายรูปอาหาร/พัสดุที่วางไว้ ณ จุดส่ง</Text>
        <Text style={styles.guidanceBody}>
          ให้เห็นจุดวางพอเป็นหลักฐาน · ไม่ต้องมีคนอยู่ในรูป
        </Text>
        <Text style={styles.guidanceBody}>ไม่ต้องถ่ายหน้าลูกค้า ไม่ต้องถ่ายบัตรหรือเอกสาร</Text>

        {captureError ? (
          <Text style={styles.captureError} testID="proof-capture-error">
            {captureError}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => void capture()}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel="ถ่ายรูปหลักฐาน"
          accessibilityState={{ disabled: capturing, busy: capturing }}
          testID="button-shutter"
          style={[styles.shutter, capturing ? styles.shutterBusy : null]}
        >
          {capturing ? <ActivityIndicator color={colors.textPrimary} /> : null}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * The POD dark-surface set (POD UX design §A), used only by the camera and
 * review screens. Values are literal here rather than in
 * `packages/ui/src/theme/tokens.ts` because they are the only dark surfaces in
 * either app, and adding a dark layer to the shared light-only token set for
 * two screens would widen a package the customer app also consumes.
 */
const DARK_GROUND = '#141210';
const DARK_SCRIM = 'rgba(20,18,16,0.58)';
const DARK_TEXT = '#FFFFFF';
const DARK_TEXT_MUTED = 'rgba(255,255,255,0.78)';

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: DARK_GROUND },
  viewfinder: { ...StyleSheet.absoluteFillObject },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  topTitle: { color: DARK_TEXT, fontFamily: fontFamily.semibold, fontSize: fontSize.lg },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { color: DARK_TEXT, fontSize: fontSize.xl, fontFamily: fontFamily.regular },

  guidance: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    // Guidance sits on a scrim, never directly on the live image, so it stays
    // readable against any scene.
    backgroundColor: DARK_SCRIM,
  },
  guidanceTitle: {
    color: DARK_TEXT,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  guidanceBody: {
    color: DARK_TEXT_MUTED,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  captureError: {
    color: colors.danger,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  // 82 px, per the design — pressed with a glove, on a bike stand, in a hurry.
  // A white ring around a filled core, so it is findable without colour.
  shutter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: DARK_TEXT,
    backgroundColor: DARK_TEXT_MUTED,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  shutterBusy: { opacity: 0.6 },

  rationale: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    justifyContent: 'center',
  },
  rationaleTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.h2, color: colors.textPrimary },
  rationaleBody: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  rationaleBullet: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  rationaleFootnote: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSubtle,
  },
  blockedMark: { fontSize: fontSize.h1, textAlign: 'center' },
});

export const proofCameraRadius = radius.lg;
