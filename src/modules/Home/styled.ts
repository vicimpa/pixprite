import styled from 'styled-components';
import { Button } from '~/ui/Button';

/** Home actions can grow with translated labels and the chosen UI font. */
export const Action = styled(Button)`
  min-width: 0;
  max-width: 100%;
  min-height: var(--row);
  height: auto;
  padding: 5px 8px;
  white-space: normal;
  overflow-wrap: anywhere;
  flex-wrap: wrap;
`;
