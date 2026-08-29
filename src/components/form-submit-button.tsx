"use client";

import { useFormStatus } from "react-dom";

type FormSubmitButtonProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  pendingLabel?: string;
  type?: "button" | "submit";
  value?: string;
};

export function FormSubmitButton({
  children,
  className,
  disabled = false,
  name,
  onClick,
  pendingLabel,
  type = "submit",
  value,
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type={type}
      name={name}
      onClick={onClick}
      value={value}
      disabled={pending || disabled}
      className={className}
    >
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
