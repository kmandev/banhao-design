import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProofReviewScreen } from './ProofReviewScreen';

/**
 * P-05 ตรวจรูปก่อนยืนยัน — direct coverage for `ProofReviewScreen` itself.
 *
 * `ProofCameraScreen.test.tsx` already covers navigating INTO this screen
 * (the shape of the `ProofReview` route params it's pushed with), and
 * `DeliveryConfirmScreen.test.tsx` already covers everything downstream of
 * ใช้รูปนี้ (upload, presign, submission, retry). This file is only about
 * what `ProofReviewScreen` itself renders and wires: the preview, the
 * caption/question copy, and the two actions' navigation calls. No capture,
 * no upload, no submission — none of that runs through this screen.
 */

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';

const PHOTO = {
  uri: 'file:///tmp/proof.jpg',
  width: 1600,
  height: 1200,
  contentType: 'image/jpeg' as const,
  capturedAt: '2026-08-26T11:45:12.000Z',
};

let mockRouteParams: { deliveryId: string; photo: typeof PHOTO } = {
  deliveryId: DELIVERY_ID,
  photo: PHOTO,
};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

/** Flattens a Text node's children the same way HomeScreen.test.tsx's `textOf` does. */
function textOf(node: { props: { children?: unknown } }): string {
  const flatten = (value: unknown): string => {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (Array.isArray(value)) return value.map(flatten).join('');
    if (typeof value === 'object' && 'props' in (value as Record<string, unknown>)) {
      return flatten((value as { props: { children?: unknown } }).props.children);
    }
    return String(value);
  };
  return flatten(node.props.children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { deliveryId: DELIVERY_ID, photo: PHOTO };
});

describe('ProofReviewScreen — rendering', () => {
  it('renders the screen and the title', () => {
    render(<ProofReviewScreen />);

    expect(screen.getByTestId('screen-proof-review')).toBeTruthy();
    expect(screen.getByText('ตรวจรูปก่อนยืนยัน')).toBeTruthy();
  });

  it('renders the photo preview from the route param photo, not a hard-coded one', () => {
    render(<ProofReviewScreen />);

    const preview = screen.getByTestId('proof-preview');
    expect(preview.props.source).toEqual({ uri: PHOTO.uri });
  });

  it('exposes the preview as an accessible image with a spoken label, never a bare thumbnail', () => {
    render(<ProofReviewScreen />);

    const preview = screen.getByTestId('proof-preview');
    expect(preview.props.accessible).toBe(true);
    expect(preview.props.accessibilityRole).toBe('image');
    expect(preview.props.accessibilityLabel).toMatch(/^รูปหลักฐานการส่ง ถ่ายเมื่อ /);
  });

  it('shows the captured-at caption', () => {
    render(<ProofReviewScreen />);

    expect(textOf(screen.getByTestId('proof-captured-at'))).toContain('ถ่ายเมื่อ');
  });

  it('asks whether the food and drop point are clear, and that a retake is free', () => {
    render(<ProofReviewScreen />);

    expect(screen.getByText('เห็นอาหารและจุดวางชัดเจนไหม ถ้าไม่ชัด ถ่ายใหม่ได้')).toBeTruthy();
  });

  it('renders a different photo when the route gives it a different one', () => {
    mockRouteParams = {
      deliveryId: DELIVERY_ID,
      photo: { ...PHOTO, uri: 'file:///tmp/second-attempt.jpg' },
    };

    render(<ProofReviewScreen />);

    expect(screen.getByTestId('proof-preview').props.source).toEqual({
      uri: 'file:///tmp/second-attempt.jpg',
    });
  });
});

describe('ProofReviewScreen — actions', () => {
  it('ถ่ายใหม่ replaces the screen with the camera for the same delivery — nothing uploaded, no extra stack level', () => {
    render(<ProofReviewScreen />);

    fireEvent.press(screen.getByTestId('button-retake'));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('ProofCamera', { deliveryId: DELIVERY_ID });
  });

  it('ใช้รูปนี้ replaces the screen with DeliveryConfirm, carrying the same photo forward unchanged', () => {
    render(<ProofReviewScreen />);

    fireEvent.press(screen.getByTestId('button-use-photo'));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('DeliveryConfirm', { deliveryId: DELIVERY_ID, photo: PHOTO });
  });

  it('ใช้รูปนี้ does not itself call goBack or navigate — replace is the only navigation call', () => {
    render(<ProofReviewScreen />);

    fireEvent.press(screen.getByTestId('button-use-photo'));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('both actions are present and pressable at the same time — retake is never hidden once a photo exists', () => {
    render(<ProofReviewScreen />);

    expect(screen.getByTestId('button-retake')).toBeTruthy();
    expect(screen.getByTestId('button-use-photo')).toBeTruthy();
  });
});
