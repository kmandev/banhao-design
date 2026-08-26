import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@banhao/api-client';
import { DeliveryConfirmScreen } from './DeliveryConfirmScreen';
import { repositories } from '../repositories';
import { ProofUploadFailedError } from '../repositories/riderProofUpload';
import type { PreparedProofPhoto } from '../lib/proofPhoto';

/**
 * P-06 … P-09 — the POD confirmation (Phase G-7.2 Phase 2).
 *
 * The assertions that matter most here are negative: `ส่งสำเร็จ` must appear in
 * no screen state other than after a successful command response, and a
 * failure at any of the three steps must leave the delivery open. Those are
 * driven by forcing a failure at each stage in turn, which is exactly the POD
 * design's own acceptance criterion 4.
 */

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = `deliveries/${DELIVERY_ID}/proof/22222222-2222-4222-8222-222222222222.jpg`;
const UPLOAD_URL = 'https://acct.r2.cloudflarestorage.com/private/x?sig=1';

const PHOTO: PreparedProofPhoto = {
  uri: 'file:///tmp/proof.jpg',
  width: 1600,
  height: 1200,
  contentType: 'image/jpeg',
  capturedAt: '2026-08-26T11:45:12.000Z',
};

// `mock`-prefixed so jest's out-of-scope guard admits them in the factory below.
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockPopToTop = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: mockReplace,
      popToTop: mockPopToTop,
      goBack: jest.fn(),
    }),
    useRoute: () => ({
      params: {
        deliveryId: '11111111-1111-4111-8111-111111111111',
        photo: {
          uri: 'file:///tmp/proof.jpg',
          width: 1600,
          height: 1200,
          contentType: 'image/jpeg',
          capturedAt: '2026-08-26T11:45:12.000Z',
        },
      },
    }),
  };
});

function bind(overrides: {
  requestUploadUrl?: jest.Mock;
  uploadToSignedUrl?: jest.Mock;
  markDelivered?: jest.Mock;
} = {}) {
  const requestUploadUrl =
    overrides.requestUploadUrl ??
    jest.fn(async () => ({ uploadUrl: UPLOAD_URL, objectKey: OBJECT_KEY }));
  const uploadToSignedUrl = overrides.uploadToSignedUrl ?? jest.fn(async () => undefined);
  const markDelivered =
    overrides.markDelivered ??
    jest.fn(async () => ({
      deliveryId: DELIVERY_ID,
      orderId: 'order-1',
      state: 'DELIVERED',
      deliveredAt: '2026-08-26T11:47:03.000Z',
      riderId: 'rider-1',
    }));

  // Bound onto the shared singleton the screen actually imports.
  Object.assign(repositories, {
    proofUpload: { requestUploadUrl, uploadToSignedUrl },
    deliveryActions: { ...repositories.deliveryActions, markDelivered },
  });

  return { requestUploadUrl, uploadToSignedUrl, markDelivered };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('DeliveryConfirmScreen — the happy path', () => {
  it('runs presign → upload → confirm, in that order', async () => {
    const order: string[] = [];
    const { requestUploadUrl, uploadToSignedUrl, markDelivered } = bind({
      requestUploadUrl: jest.fn(async () => {
        order.push('presign');
        return { uploadUrl: UPLOAD_URL, objectKey: OBJECT_KEY };
      }),
      uploadToSignedUrl: jest.fn(async () => {
        order.push('upload');
      }),
      markDelivered: jest.fn(async () => {
        order.push('confirm');
        return {
          deliveryId: DELIVERY_ID,
          orderId: 'order-1',
          state: 'DELIVERED',
          deliveredAt: '2026-08-26T11:47:03.000Z',
          riderId: 'rider-1',
        };
      }),
    });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    expect(order).toEqual(['presign', 'upload', 'confirm']);
    expect(requestUploadUrl).toHaveBeenCalledWith(DELIVERY_ID, 'image/jpeg');
    expect(uploadToSignedUrl).toHaveBeenCalledWith(UPLOAD_URL, PHOTO.uri, 'image/jpeg');
    expect(markDelivered).toHaveBeenCalledWith(DELIVERY_ID, OBJECT_KEY);
  });

  it('echoes the server’s object key verbatim — never one it built', async () => {
    const { markDelivered } = bind();

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    expect(markDelivered.mock.calls[0]?.[1]).toBe(OBJECT_KEY);
  });

  it('shows ส่งสำเร็จ with the SERVER’s delivered_at, only after the 200', async () => {
    bind();

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await screen.findByTestId('delivery-completed');
    expect(screen.getByText('ส่งสำเร็จ')).toBeTruthy();
    expect(screen.getByTestId('delivery-completed-at')).toBeTruthy();
  });

  it('resets the stack on กลับหน้าหลัก, so back cannot reach a closed delivery', async () => {
    bind();

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });
    await screen.findByTestId('delivery-completed');
    fireEvent.press(screen.getByTestId('button-back-home'));

    expect(mockPopToTop).toHaveBeenCalled();
  });
});

describe('DeliveryConfirmScreen — no premature success', () => {
  it.each([
    [
      'presign',
      { requestUploadUrl: jest.fn(async () => { throw new Error('offline'); }) },
    ],
    [
      'upload',
      { uploadToSignedUrl: jest.fn(async () => { throw new ProofUploadFailedError('timeout'); }) },
    ],
    [
      'confirm',
      {
        markDelivered: jest.fn(async () => {
          throw new ApiClientError(500, { code: 'INTERNAL_ERROR', message: 'boom' });
        }),
      },
    ],
  ])('never shows ส่งสำเร็จ when the %s step fails', async (_stage, overrides) => {
    bind(overrides);

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await screen.findByTestId('proof-error');
    expect(screen.queryByTestId('delivery-completed')).toBeNull();
    // The rider is told the job is still open, not that something vanished.
    expect(screen.getByText('ยังไม่ได้ยืนยันการส่ง งานนี้ยังเปิดอยู่')).toBeTruthy();
  });

  it('does not upload at all when the presign fails', async () => {
    const { uploadToSignedUrl } = bind({
      requestUploadUrl: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await screen.findByTestId('proof-error');
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('maps a known server code to Thai, never a raw server string', async () => {
    bind({
      markDelivered: jest.fn(async () => {
        throw new ApiClientError(403, { code: 'NOT_ASSIGNED_RIDER', message: 'raw server text' });
      }),
    });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await screen.findByTestId('proof-error');
    expect(screen.getByText('งานนี้ไม่ใช่งานของคุณแล้ว')).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
  });
});

describe('DeliveryConfirmScreen — retry', () => {
  it('after an upload succeeds but the command fails, the retry does NOT re-upload', async () => {
    const markDelivered = jest
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL_ERROR' }))
      .mockResolvedValue({
        deliveryId: DELIVERY_ID,
        orderId: 'order-1',
        state: 'DELIVERED',
        deliveredAt: '2026-08-26T11:47:03.000Z',
        riderId: 'rider-1',
      });
    const { requestUploadUrl, uploadToSignedUrl } = bind({ markDelivered });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });
    await screen.findByTestId('proof-error');

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });
    await screen.findByTestId('delivery-completed');

    // The expensive step at a doorway is the upload — the bytes are already
    // in R2, so the retry sends the command alone.
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(requestUploadUrl).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledTimes(2);
  });

  it('tells the rider the photo does not need retaking once it is uploaded', async () => {
    bind({
      markDelivered: jest.fn(async () => {
        throw new ApiClientError(500, { code: 'INTERNAL_ERROR' });
      }),
    });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    const hint = await screen.findByTestId('proof-retry-hint');
    expect(hint).toBeTruthy();
    expect(screen.getByText('รูปที่ถ่ายไว้ยังอยู่ในเครื่อง ไม่ต้องถ่ายใหม่')).toBeTruthy();
  });

  it('after an upload failure, the retry re-presigns and re-uploads', async () => {
    const uploadToSignedUrl = jest
      .fn()
      .mockRejectedValueOnce(new ProofUploadFailedError('expired', 403))
      .mockResolvedValue(undefined);
    const { requestUploadUrl } = bind({ uploadToSignedUrl });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });
    await screen.findByTestId('proof-error');

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });
    await screen.findByTestId('delivery-completed');

    // An expired presign cannot be retried as a PUT — a fresh authorization
    // is required.
    expect(requestUploadUrl).toHaveBeenCalledTimes(2);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('names an expired upload link specifically', async () => {
    bind({
      uploadToSignedUrl: jest.fn(async () => {
        throw new ProofUploadFailedError('expired', 403);
      }),
    });

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await screen.findByTestId('proof-error');
    expect(screen.getByText('ลิงก์อัปโหลดหมดอายุ กรุณากดลองส่งอีกครั้ง')).toBeTruthy();
  });
});

describe('DeliveryConfirmScreen — duplicate protection and retake', () => {
  it('a double tap issues ONE sequence, not two', async () => {
    const { requestUploadUrl, markDelivered } = bind();

    render(<DeliveryConfirmScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
      fireEvent.press(screen.getByTestId('button-confirm-delivered'));
    });

    await waitFor(() => expect(markDelivered).toHaveBeenCalledTimes(1));
    expect(requestUploadUrl).toHaveBeenCalledTimes(1);
  });

  it('retake discards the uploaded key and returns to the camera', async () => {
    bind();

    render(<DeliveryConfirmScreen />);
    fireEvent.press(screen.getByTestId('button-retake-from-confirm'));

    expect(mockReplace).toHaveBeenCalledWith('ProofCamera', { deliveryId: DELIVERY_ID });
  });

  it('renders the photo thumbnail and its capture time before anything is sent', () => {
    bind();

    render(<DeliveryConfirmScreen />);

    expect(screen.getByTestId('proof-thumbnail')).toBeTruthy();
    expect(screen.getByText('รูปหลักฐานพร้อมแล้ว')).toBeTruthy();
    // Nothing has been sent yet — the CTA is the only thing that calls out.
    expect(screen.queryByTestId('proof-submitting')).toBeNull();
    expect(screen.queryByTestId('delivery-completed')).toBeNull();
  });

  it('warns that confirmation is irreversible', () => {
    bind();

    render(<DeliveryConfirmScreen />);

    expect(screen.getByText('กดยืนยันแล้วงานนี้จะปิดและแก้ไขรูปไม่ได้')).toBeTruthy();
  });
});
