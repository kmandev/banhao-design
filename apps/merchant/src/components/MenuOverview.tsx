'use client';

import { useMemo, useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import type { CreateMenuItemInput, MenuOptionGroupInput, UpdateMenuItemInput } from '@banhao/validation';
import type { MenuCategory, MenuItem, MenuOptionGroup } from '../domain/menu';
import { useMenu } from '../hooks/useMenu';
import { menuCopy } from '../lib/menuCopy';
import { summariseMenu } from '../lib/menuDisplay';
import { formatBahtFixed } from '../lib/orderBoardDisplay';
import { ApiClientError } from '../lib/apiClient';
import { repositories, type MerchantMenuRepository } from '../repositories';
import { AvailabilitySwitch } from './AvailabilitySwitch';
import { CategoryManagerDialog } from './CategoryManagerDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorState } from './ErrorState';
import { ItemReorderList } from './ItemReorderList';
import { MenuItemDrawer } from './MenuItemDrawer';
import { OptionGroupEditor } from './OptionGroupEditor';
import { Spinner } from './Spinner';
import * as m from '../lib/menuStyles';

/**
 * M-11 §02 — the menu overview.
 *
 * Categories are **sections in one scroll, not tabs** (M11-D01):
 * `menu_categories.sort_order` already defines what a customer sees in C-07,
 * and a merchant checking their menu should see the same sequence in one view.
 * Tabs would hide it and add a click per section.
 *
 * An empty category keeps its header and its add action (M11-D10) — a merchant
 * builds structure before content, and hiding the empty section makes their
 * own work look lost.
 *
 * The row itself opens the edit drawer; the switch and `⋯` are **siblings**,
 * not nested inside it, so activating one never triggers the other (M-11 §11).
 */

type Busy =
  | { kind: 'idle' }
  | { kind: 'saving-item' }
  | { kind: 'saving-category' }
  | { kind: 'saving-options' };

export function MenuOverview({
  restaurantId,
  repository = repositories.merchantMenu,
}: {
  restaurantId: string;
  repository?: MerchantMenuRepository;
}) {
  const menu = useMenu(restaurantId, repository);

  const [drawerItem, setDrawerItem] = useState<MenuItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategoryId, setDrawerCategoryId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [removing, setRemoving] = useState<MenuItem | null>(null);
  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroup[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [busy, setBusy] = useState<Busy>({ kind: 'idle' });
  const [failure, setFailure] = useState<{ forbidden: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [reordering, setReordering] = useState<{
    categoryId: string;
    saving: boolean;
    failed: boolean;
  } | null>(null);
  const reorderTriggerRef = useRef<HTMLButtonElement | null>(null);

  const sections = menu.state.status === 'ready' ? menu.state.sections : [];
  const categories: MenuCategory[] = useMemo(
    () => sections.map((section) => section.category),
    [sections],
  );
  const itemCounts = useMemo(
    () => new Map(sections.map((section) => [section.category.id, section.items.length])),
    [sections],
  );
  const summary = useMemo(() => summariseMenu(sections), [sections]);

  const run = async (kind: Busy['kind'], work: () => Promise<unknown>, onDone?: () => void) => {
    setBusy({ kind } as Busy);
    setFailure(null);
    try {
      await work();
      menu.reload();
      setToast(menuCopy.saved);
      onDone?.();
    } catch (error: unknown) {
      const forbidden =
        error instanceof ApiClientError &&
        (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN');
      setFailure({ forbidden });
    } finally {
      setBusy({ kind: 'idle' });
    }
  };

  const exitReorder = () => {
    setReordering(null);
    reorderTriggerRef.current?.focus();
  };

  const saveItemOrder = async (categoryId: string, menuItemIds: string[]) => {
    setReordering({ categoryId, saving: true, failed: false });
    try {
      await repository.reorderItems(restaurantId, categoryId, menuItemIds);
      menu.reload();
      setToast(menuCopy.reorderSaved);
      exitReorder();
    } catch {
      // Stays in reorder mode with the draft intact — ItemReorderList holds
      // its own draft state and does not lose it on a failed save (§17-F).
      setReordering({ categoryId, saving: false, failed: true });
    }
  };

  const openOptionEditor = async (item: MenuItem) => {
    setOptionItem(item);
    setOptionsLoading(true);
    try {
      setOptionGroups(await repository.listOptionGroups(item.id));
    } catch {
      setOptionGroups([]);
    } finally {
      setOptionsLoading(false);
    }
  };

  if (menu.state.status === 'loading') {
    return <Spinner label={menuCopy.loading} />;
  }

  if (menu.state.status === 'error') {
    // A 403 gets its own copy and no retry — a retry cannot fix a membership.
    return menu.state.forbidden ? (
      <ErrorState title={menuCopy.forbidden} />
    ) : (
      <ErrorState
        title={menuCopy.loadFailed}
        message={menuCopy.loadFailedHint}
        retryLabel={menuCopy.retry}
        onRetry={menu.reload}
      />
    );
  }

  const empty = sections.length === 0;

  return (
    <div style={m.contentPage} data-testid="menu-overview">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
            {menuCopy.pageTitle}
          </h1>
          <p style={{ ...m.fieldHint, marginTop: 4 }} data-testid="menu-summary">
            {menuCopy.summary(summary.itemCount, summary.unavailableCount)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          <button type="button" style={m.secondaryButton} onClick={() => setCategoriesOpen(true)}>
            {menuCopy.manageCategories}
          </button>
          <button
            type="button"
            style={m.primaryButton}
            // A dish cannot exist outside a category (`category_id not null`),
            // so with none the add action routes to the category form first.
            onClick={() => {
              if (categories.length === 0) {
                setCategoriesOpen(true);
                return;
              }
              setDrawerItem(null);
              setDrawerCategoryId(null);
              setDrawerOpen(true);
            }}
            data-testid="add-item"
          >
            {menuCopy.addItem}
          </button>
        </div>
      </div>

      {menu.availabilityError ? (
        <div role="alert" style={{ ...m.panel, borderColor: colors.danger }} data-testid="availability-error">
          <span style={{ color: colors.danger, fontSize: 14 }}>{menuCopy.availabilityFailed}</span>
        </div>
      ) : null}

      {empty ? (
        <div style={{ ...m.panel, textAlign: 'center' }} data-testid="menu-empty">
          <h2 style={{ fontSize: 18, color: colors.textPrimary, margin: 0 }}>{menuCopy.emptyTitle}</h2>
          <p style={{ ...m.fieldHint, marginTop: spacing.sm }}>{menuCopy.emptyBody}</p>
          <button
            type="button"
            style={{ ...m.primaryButton, marginTop: spacing.md }}
            onClick={() => setCategoriesOpen(true)}
            data-testid="create-first-category"
          >
            {menuCopy.emptyCta}
          </button>
        </div>
      ) : null}

      {sections.map((section, index) => {
        const isReorderingThis = reordering?.categoryId === section.category.id;
        // Another category's draft is open — this entry stays visible but
        // inert so switching categories cannot silently discard it (§17: no
        // autosave, and Cancel/Escape are the only ways to discard a draft).
        const reorderBlockedByOther = reordering !== null && !isReorderingThis;

        return (
        <section key={section.category.id} style={m.panel}>
          <div style={m.sectionHeader}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
              {section.category.name}
            </h2>
            <span style={m.badge}>{menuCopy.itemCount(section.items.length)}</span>
            <span style={{ ...m.fieldHint, marginLeft: 'auto' }}>
              {menuCopy.categoryPosition(index + 1)}
            </span>
            {/* §17-A: hidden entirely below two items — an empty or single-item
                category has nothing to reorder. */}
            {!isReorderingThis && section.items.length >= 2 ? (
              <button
                type="button"
                style={m.secondaryButton}
                aria-label={menuCopy.reorderEntryLabel(section.category.name)}
                aria-disabled={reorderBlockedByOther}
                title={reorderBlockedByOther ? menuCopy.reorderChanged : undefined}
                onClick={(event) => {
                  if (reorderBlockedByOther) return;
                  reorderTriggerRef.current = event.currentTarget;
                  setReordering({ categoryId: section.category.id, saving: false, failed: false });
                  setAnnouncement(menuCopy.reorderModeEnter(section.category.name));
                }}
                data-testid={`reorder-entry-${section.category.name}`}
              >
                {menuCopy.reorderEntry}
              </button>
            ) : null}
          </div>

          {isReorderingThis ? (
            <ItemReorderList
              categoryName={section.category.name}
              items={section.items}
              saving={reordering.saving}
              failed={reordering.failed}
              onSave={(menuItemIds) => void saveItemOrder(section.category.id, menuItemIds)}
              onCancel={() => {
                setAnnouncement(menuCopy.reorderModeExit);
                exitReorder();
              }}
            />
          ) : (
            <>
          {section.items.length === 0 ? (
            <div style={{ padding: `${spacing.md}px 0` }} data-testid={`empty-category-${section.category.name}`}>
              <p style={m.fieldHint}>{menuCopy.emptyCategory}</p>
              <button
                type="button"
                style={{ ...m.secondaryButton, marginTop: spacing.sm }}
                onClick={() => {
                  setDrawerItem(null);
                  setDrawerCategoryId(section.category.id);
                  setDrawerOpen(true);
                }}
              >
                {menuCopy.addItemToCategory}
              </button>
            </div>
          ) : null}

          {section.items.map((item) => (
            <div
              key={item.id}
              style={{
                ...m.itemRow,
                // The row dims when the dish is off sale, and the pill below
                // says so in words — colour never carries the state alone.
                backgroundColor: item.isAvailable ? undefined : colors.surface,
              }}
              data-testid={`menu-row-${item.name}`}
            >
              <button
                type="button"
                style={{ ...m.itemIdentity, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', minHeight: m.TOUCH_TARGET }}
                onClick={() => {
                  setDrawerItem(item);
                  setDrawerCategoryId(null);
                  setDrawerOpen(true);
                }}
                data-testid={`edit-item-${item.name}`}
              >
                <span style={m.itemName}>{item.name}</span>
                {item.description ? <span style={m.itemDescription}>{item.description}</span> : null}
              </button>

              {item.optionGroupCount > 0 ? (
                <span style={m.badge}>{menuCopy.optionCount(item.optionGroupCount)}</span>
              ) : null}
              {!item.isAvailable ? <span style={m.badge}>{menuCopy.unavailable}</span> : null}

              <span style={m.price}>{formatBahtFixed(item.basePriceSatang)}</span>

              <AvailabilitySwitch
                itemName={item.name}
                isAvailable={item.isAvailable}
                pending={menu.pendingAvailabilityId === item.id}
                onToggle={(next) => void menu.setAvailability(item.id, next)}
              />

              <button
                type="button"
                style={m.iconButton}
                aria-label={`${menuCopy.remove}: ${item.name}`}
                onClick={() => setRemoving(item)}
                data-testid={`remove-item-${item.name}`}
              >
                ⋯
              </button>
            </div>
          ))}
            </>
          )}
        </section>
        );
      })}

      <MenuItemDrawer
        open={drawerOpen}
        item={drawerItem}
        categories={categories}
        defaultCategoryId={drawerCategoryId}
        saving={busy.kind === 'saving-item'}
        failure={failure}
        onCreate={(input: CreateMenuItemInput) =>
          void run('saving-item', () => repository.createItem(restaurantId, input), () => setDrawerOpen(false))
        }
        onUpdate={(menuItemId, input: UpdateMenuItemInput) =>
          void run('saving-item', () => repository.updateItem(menuItemId, input), () => setDrawerOpen(false))
        }
        onClose={() => {
          setDrawerOpen(false);
          setFailure(null);
        }}
        onEditOptions={(item) => void openOptionEditor(item)}
      />

      <CategoryManagerDialog
        open={categoriesOpen}
        categories={categories}
        itemCounts={itemCounts}
        busy={busy.kind === 'saving-category'}
        onCreate={(name) => void run('saving-category', () => repository.createCategory(restaurantId, { name }))}
        onRename={(id, name) => void run('saving-category', () => repository.renameCategory(id, name))}
        onArchive={(category) =>
          void run('saving-category', () => repository.archiveCategory(category.id))
        }
        onSaveOrder={(ids) =>
          void run('saving-category', () => repository.reorderCategories(restaurantId, ids), () =>
            setCategoriesOpen(false),
          )
        }
        onClose={() => setCategoriesOpen(false)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={removing ? menuCopy.removeItemTitle(removing.name) : ''}
        body={menuCopy.removeItemBody}
        confirmLabel={menuCopy.removeConfirm}
        cancelLabel={menuCopy.cancel}
        pending={busy.kind === 'saving-item'}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          void run('saving-item', () => repository.archiveItem(target.id), () => setRemoving(null));
        }}
        onCancel={() => setRemoving(null)}
        testId="remove-item-dialog"
      />

      <OptionGroupEditor
        open={optionItem !== null}
        item={optionItem}
        groups={optionGroups}
        loading={optionsLoading}
        saving={busy.kind === 'saving-options'}
        failure={failure}
        onSave={(menuItemId, groups: MenuOptionGroupInput[]) =>
          void run('saving-options', () => repository.replaceOptionGroups(menuItemId, groups), () =>
            setOptionItem(null),
          )
        }
        onClose={() => setOptionItem(null)}
      />

      <span style={m.visuallyHidden} aria-live="polite" data-testid="menu-toast">
        {toast ?? ''}
      </span>
      <span style={m.visuallyHidden} aria-live="polite" data-testid="menu-mode-announcement">
        {announcement}
      </span>
    </div>
  );
}
