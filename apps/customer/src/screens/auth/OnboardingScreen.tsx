import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { Screen } from '../../components/Screen';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Onboarding'>;

/**
 * 02 Onboarding. Copy is taken verbatim from the design artifact.
 */
export function OnboardingScreen({ navigation }: Props) {
  return (
    <Screen testID="screen-onboarding">
      <View style={styles.body}>
        <View style={styles.mark}>
          <Text style={styles.markGlyph}>🏠</Text>
        </View>
        <Text style={styles.title}>สั่งอาหารในบุณฑริก{'\n'}ง่ายกว่าที่เคย</Text>
        <Text style={styles.copy}>
          ร้านในบุณฑริกให้เลือกเพียบ{'\n'}ค่าส่งเริ่มต้น 10 บาท รู้ราคาก่อนสั่งเสมอ
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="เริ่มใช้งาน" onPress={() => navigation.navigate('Login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  mark: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: { fontFamily: fontFamily.regular, fontSize: 42 },
  title: {
    fontSize: fontSize.h1,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 36,
  },
  copy: {
    fontFamily: fontFamily.regular, fontSize: fontSize.lg,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 26,
  },
  actions: { paddingBottom: spacing.xl },
});
