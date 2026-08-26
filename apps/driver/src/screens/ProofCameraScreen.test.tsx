import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ProofCameraScreen } from './ProofCameraScreen';

/**
 * P-03 / P-04 / P-10 — the camera permission rationale, the viewfinder, and
 * the blocked state (Phase G-7.2 Phase 2).
 *
 * The assertions here are about the **permission contract** rather than the
 * viewfinder's pixels: that the OS prompt is never triggered on mount, that a
 * permanently denied rider gets a route forward and never a way to close the
 * delivery, and that a failed capture keeps the camera open rather than
 * advancing with an unusable file.
 */

// `mock`-prefixed so jest's out-of-scope guard admits them in the factories.
const mockRequestPermission = jest.fn();
const mockTakePictureAsync = jest.fn();
const mockPrepareProofPhoto = jest.fn();
const mockOpenSettings = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();

let mockPermissionState: { granted: boolean; canAskAgain: boolean } | null = {
  granted: true,
  canAskAgain: true,
};

jest.mock('expo-camera', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    useCameraPermissions: () => [mockPermissionState, mockRequestPermission],
    CameraView: React.forwardRef((_props: unknown, ref: unknown) => {
      (ref as { current: unknown }).current = { takePictureAsync: mockTakePictureAsync };
      return null;
    }),
  };
});

jest.mock('../lib/proofPhoto', () => {
  const actual = jest.requireActual('../lib/proofPhoto') as Record<string, unknown>;
  return {
    ...actual,
    prepareProofPhoto: (...args: unknown[]) => mockPrepareProofPhoto(...args),
  };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack, navigate: jest.fn() }),
    useRoute: () => ({ params: { deliveryId: '11111111-1111-4111-8111-111111111111' } }),
  };
});

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openSettings: () => mockOpenSettings(),
  addEventListener: jest.fn(),
  getInitialURL: jest.fn(async () => null),
  openURL: jest.fn(),
}));

const PREPARED = {
  uri: 'file:///tmp/proof.jpg',
  width: 1600,
  height: 1200,
  contentType: 'image/jpeg' as const,
  capturedAt: '2026-08-26T11:45:12.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissionState = { granted: true, canAskAgain: true };
  mockTakePictureAsync.mockResolvedValue({ uri: 'file:///tmp/camera.jpg' });
  mockPrepareProofPhoto.mockResolvedValue(PREPARED);
});

describe('ProofCameraScreen — permission', () => {
  it('shows the rationale, and does NOT prompt on mount', () => {
    mockPermissionState = { granted: false, canAskAgain: true };

    render(<ProofCameraScreen />);

    expect(screen.getByTestId('proof-camera-rationale')).toBeTruthy();
    // A rider with no reason to say yes yet is never asked.
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('states what the camera is for, what it is not for, and who sees the photo', () => {
    mockPermissionState = { granted: false, canAskAgain: true };

    render(<ProofCameraScreen />);

    expect(screen.getByText('· ลูกค้าเห็นรูปนี้ในรายละเอียดออเดอร์ของตัวเอง')).toBeTruthy();
    expect(screen.getByText('· คุณถ่ายใหม่ได้ก่อนกดยืนยัน')).toBeTruthy();
  });

  it('prompts only when the rider asks', () => {
    mockPermissionState = { granted: false, canAskAgain: true };

    render(<ProofCameraScreen />);
    fireEvent.press(screen.getByTestId('button-request-camera-permission'));

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('ไม่ใช่ตอนนี้ returns to the job without closing it', () => {
    mockPermissionState = { granted: false, canAskAgain: true };

    render(<ProofCameraScreen />);
    fireEvent.press(screen.getByTestId('button-decline-camera-permission'));

    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows a route forward when permission is permanently denied', () => {
    mockPermissionState = { granted: false, canAskAgain: false };

    render(<ProofCameraScreen />);

    expect(screen.getByTestId('proof-camera-blocked')).toBeTruthy();
    fireEvent.press(screen.getByTestId('button-open-settings'));
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  it('offers NO completion path when the camera is blocked — the job stays open', () => {
    mockPermissionState = { granted: false, canAskAgain: false };

    render(<ProofCameraScreen />);

    // DEC-038: a rider who cannot photograph contacts an operator; there is
    // deliberately no no-photo completion anywhere in the app.
    expect(screen.queryByTestId('button-confirm-delivered')).toBeNull();
    expect(screen.getByText(/ติดต่อผู้ดูแล/)).toBeTruthy();
    expect(screen.getByText(/งานนี้ยังไม่ปิด/)).toBeTruthy();
  });

  it('renders neither rationale nor blocked state while the permission is unresolved', () => {
    mockPermissionState = null;

    render(<ProofCameraScreen />);

    // "Not yet known" must not render as "denied".
    expect(screen.getByTestId('proof-camera-initialising')).toBeTruthy();
    expect(screen.queryByTestId('proof-camera-blocked')).toBeNull();
  });
});

describe('ProofCameraScreen — capture', () => {
  it('prepares the capture and advances to review', async () => {
    render(<ProofCameraScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-shutter'));
    });

    expect(mockPrepareProofPhoto).toHaveBeenCalledWith('file:///tmp/camera.jpg');
    expect(mockReplace).toHaveBeenCalledWith('ProofReview', {
      deliveryId: '11111111-1111-4111-8111-111111111111',
      photo: PREPARED,
    });
  });

  it('asks the camera for no EXIF', async () => {
    render(<ProofCameraScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-shutter'));
    });

    expect(mockTakePictureAsync).toHaveBeenCalledWith({ quality: 1, exif: false });
  });

  it('keeps the camera open and shows one inline line when preparation fails', async () => {
    mockPrepareProofPhoto.mockRejectedValue(new Error('boom'));

    render(<ProofCameraScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-shutter'));
    });

    expect(screen.getByTestId('proof-capture-error')).toBeTruthy();
    // Never a dialog, never a navigation away from the viewfinder.
    expect(screen.getByTestId('proof-camera')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('never advances to review when the shutter returns no file', async () => {
    mockTakePictureAsync.mockResolvedValue({});

    render(<ProofCameraScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-shutter'));
    });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('proof-capture-error')).toBeTruthy();
  });

  it('offers no gallery import — a library photo could be from anywhere', () => {
    render(<ProofCameraScreen />);

    expect(screen.queryByText(/คลังรูป|เลือกรูป|แกลเลอรี/)).toBeNull();
  });

  it('states the privacy exclusions on the viewfinder itself', () => {
    render(<ProofCameraScreen />);

    expect(screen.getByText('ไม่ต้องถ่ายหน้าลูกค้า ไม่ต้องถ่ายบัตรหรือเอกสาร')).toBeTruthy();
  });
});
