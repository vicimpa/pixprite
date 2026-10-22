import { t } from "~/core/i18n";
import { Button } from "~/ui/Button";
import { LogoMark } from "~/ui/Logo";
import type { FC } from "react";
import { Box, Screen, Text, Title } from "./styled";

/** Shown instead of the editor on phones and tablets; the user may still go on */
export const MobileStub: FC<{ onContinue: () => void; }> = ({ onContinue }) => (
  <Screen>
    <Box>
      <LogoMark size={64} />
      <Title>{t('mobile.notForMobile')}</Title>
      <Text>{t('mobile.openOnComputer')}</Text>
      <Button type="button" onClick={onContinue}>{t('mobile.continueAnyway')}</Button>
    </Box>
  </Screen>
);
