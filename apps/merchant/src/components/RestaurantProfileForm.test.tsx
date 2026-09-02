import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MerchantProfileRepository } from '../repositories';
import type { RestaurantProfileRow } from '../data/restaurantProfileQueries';
import { RestaurantProfileForm } from './RestaurantProfileForm';

const ROW: RestaurantProfileRow = {
  id: 'rest-1',
  name: 'ร้านตามสั่งป้าสมร',
  description: 'ร้านก๋วยเตี๋ยวเรือ',
  cuisine: null,
  phone: '081-234-5678',
  address_line: '123 ถ.สถลมาร์ค',
  image_url: null,
  status: 'ACTIVE',
  lat: 15.1892,
  lng: 105.0872,
  updated_at: '2026-09-02T00:00:00.000Z',
};

function makeRepository(overrides: Partial<MerchantProfileRepository> = {}): MerchantProfileRepository {
  return {
    getProfile: jest.fn().mockResolvedValue(ROW),
    saveProfile: jest.fn().mockImplementation((restaurantId: string, input) =>
      Promise.resolve({ restaurantId, ...input, updatedAt: '2026-09-02T01:00:00.000Z' }),
    ),
    requestCoverUpload: jest
      .fn()
      .mockResolvedValue({ uploadUrl: 'https://r2.example/put', objectKey: 'restaurants/rest-1/cover.webp' }),
    completeCoverUpload: jest.fn().mockResolvedValue({ imageUrl: 'restaurants/rest-1/cover.webp' }),
    ...overrides,
  };
}

async function renderForm(repository = makeRepository()) {
  render(<RestaurantProfileForm restaurantId="rest-1" restaurantName="ร้านตามสั่งป้าสมร" repository={repository} />);
  await screen.findByTestId('restaurant-profile-form');
  return repository;
}

// fetch is used directly for the presigned R2 PUT — not through the API client.
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RestaurantProfileForm — loading', () => {
  it('loads the profile into the fields', async () => {
    await renderForm();

    expect(screen.getByTestId('profile-field-name')).toHaveValue(ROW.name);
    expect(screen.getByTestId('profile-field-phone')).toHaveValue(ROW.phone);
    expect(screen.getByTestId('profile-field-description')).toHaveValue(ROW.description);
    expect(screen.getByTestId('profile-field-address')).toHaveValue(ROW.address_line);
  });

  it('shows read-only coordinates, never as an editable input', async () => {
    await renderForm();

    const coordinates = screen.getByText(/15\.1892.*105\.0872/);
    expect(coordinates.tagName).not.toBe('INPUT');
  });

  it('renders the ACTIVE status pill with confirmed Thai copy', async () => {
    await renderForm();
    expect(screen.getByTestId('restaurant-status-pill')).toHaveTextContent('เปิดให้บริการ');
  });
});

describe('RestaurantProfileForm — dirty state', () => {
  it('save is disabled until a field changes', async () => {
    await renderForm();
    expect(screen.getByTestId('profile-save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('editing a field enables save', async () => {
    await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });

    expect(screen.getByTestId('profile-save')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('profile-save-footer')).toHaveTextContent('มีการเปลี่ยนแปลงที่ยังไม่บันทึก');
  });

  it('cancel restores the original values', async () => {
    await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });
    fireEvent.click(screen.getByTestId('profile-cancel'));
    fireEvent.click(screen.getByTestId('profile-discard-dialog-confirm'));

    expect(screen.getByTestId('profile-field-name')).toHaveValue(ROW.name);
  });

  it('cancel on a clean form is a no-op — no dialog opens', async () => {
    await renderForm();

    fireEvent.click(screen.getByTestId('profile-cancel'));

    expect(screen.queryByTestId('profile-discard-dialog')).not.toBeInTheDocument();
  });
});

describe('RestaurantProfileForm — validation', () => {
  it('blocks save and shows an error when name is cleared', async () => {
    await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: '   ' } });

    expect(screen.getByText('กรุณากรอกชื่อร้าน')).toBeInTheDocument();
    expect(screen.getByTestId('profile-save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('blocks save on an implausible phone, but not on an empty one', async () => {
    await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-phone'), { target: { value: 'not-a-phone' } });
    expect(screen.getByText('รูปแบบเบอร์โทรไม่ถูกต้อง')).toBeInTheDocument();
    expect(screen.getByTestId('profile-save')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(screen.getByTestId('profile-field-phone'), { target: { value: '' } });
    expect(screen.queryByText('รูปแบบเบอร์โทรไม่ถูกต้อง')).not.toBeInTheDocument();
  });

  it('an empty address is advisory only — never blocks save', async () => {
    await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-address'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });

    expect(screen.getByTestId('profile-address-advisory')).toBeInTheDocument();
    expect(screen.getByTestId('profile-save')).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('RestaurantProfileForm — save', () => {
  it('saves the whole field set and shows success', async () => {
    const repository = await renderForm();

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });
    fireEvent.click(screen.getByTestId('profile-save'));

    await screen.findByTestId('profile-saved');
    expect(repository.saveProfile).toHaveBeenCalledWith('rest-1', {
      name: 'ชื่อใหม่',
      description: ROW.description,
      phone: ROW.phone,
      addressLine: ROW.address_line,
    });
  });

  it('disables both buttons while saving, preventing a duplicate submit', async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    const repository = makeRepository({
      saveProfile: jest.fn().mockImplementation(() => new Promise((resolve) => (resolveSave = resolve))),
    });
    await renderForm(repository);

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });
    fireEvent.click(screen.getByTestId('profile-save'));

    expect(screen.getByTestId('profile-save')).toHaveTextContent('กำลังบันทึก…');
    fireEvent.click(screen.getByTestId('profile-save'));
    expect(repository.saveProfile).toHaveBeenCalledTimes(1);

    resolveSave({
      restaurantId: 'rest-1',
      name: 'ชื่อใหม่',
      description: ROW.description,
      phone: ROW.phone,
      addressLine: ROW.address_line,
      updatedAt: '2026-09-02T01:00:00.000Z',
    });
    await screen.findByTestId('profile-saved');
  });

  it('renders a server error and keeps every typed value intact', async () => {
    const repository = makeRepository({ saveProfile: jest.fn().mockRejectedValue(new Error('network')) });
    await renderForm(repository);

    fireEvent.change(screen.getByTestId('profile-field-name'), { target: { value: 'ชื่อใหม่' } });
    fireEvent.click(screen.getByTestId('profile-save'));

    await screen.findByTestId('profile-save-error');
    expect(screen.getByTestId('profile-field-name')).toHaveValue('ชื่อใหม่');
  });
});

describe('RestaurantProfileForm — cover photo (existing M-11 flow)', () => {
  it('uploads through the existing two-call flow and shows success', async () => {
    const repository = await renderForm();
    const file = new File(['x'], 'cover.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByTestId('profile-photo-input'), { target: { files: [file] } });

    await screen.findByTestId('profile-photo-success');
    expect(repository.requestCoverUpload).toHaveBeenCalledWith('rest-1', 'image/webp');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://r2.example/put',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(repository.completeCoverUpload).toHaveBeenCalledWith(
      'rest-1',
      'restaurants/rest-1/cover.webp',
    );
  });

  it('shows an error and leaves the previous photo in place when the R2 PUT fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    const repository = await renderForm();
    const file = new File(['x'], 'cover.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByTestId('profile-photo-input'), { target: { files: [file] } });

    await screen.findByTestId('profile-photo-error');
    expect(repository.completeCoverUpload).not.toHaveBeenCalled();
  });

  it('does not save the text-field form as a side effect of a photo upload', async () => {
    const repository = await renderForm();
    const file = new File(['x'], 'cover.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByTestId('profile-photo-input'), { target: { files: [file] } });
    await screen.findByTestId('profile-photo-success');

    expect(repository.saveProfile).not.toHaveBeenCalled();
  });
});
