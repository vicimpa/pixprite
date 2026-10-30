import { t } from "~/core/i18n";
import { askConfirm } from "~/ui/Dialog";

export function permissionText(p: string) {
  if (p.startsWith('network:')) {
    const host = p.slice(8);
    return host === '*' ? t('extensions.perm.networkAny') : t('extensions.perm.network', { host });
  }
  const key = ({
    'sprite:read': 'spriteRead', 'sprite:write': 'spriteWrite', 'tags:lock': 'tagsLock',
    'ui:panel': 'uiPanel', 'storage': 'storage', 'clipboard': 'clipboard',
  } as Record<string, string>)[p];
  return key ? t(`extensions.perm.${key}`) : p;
}

/** Asks before installing; resolves true when the user agrees */
export function confirmInstall(name: string, permissions: string[]) {
  const list = permissions.length
    ? `${t('extensions.permissionsAsked')}\n${permissions.map(p => `• ${permissionText(p)}`).join('\n')}`
    : t('extensions.noPermissions');
  return askConfirm(`${t('extensions.installQuestion', { name })}\n\n${list}`, { title: t('extensions.install'), ok: t('extensions.install') });
}

