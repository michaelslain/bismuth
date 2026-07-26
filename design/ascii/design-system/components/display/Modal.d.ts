/** Centred dialog on a dim scrim — translucent ground, blur, hairline border. */
export interface ModalProps {
  open?: boolean;
  title?: React.ReactNode;
  width?: number;
  onClose?: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}
export declare function Modal(props: ModalProps): JSX.Element | null;
