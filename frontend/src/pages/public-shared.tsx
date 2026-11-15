export function Steps({ step }: { step: number }) {
  return (
    <ol
      className="editor-steps mb-8 grid grid-cols-3 gap-2"
      aria-label="Etapas da inscrição"
    >
      {['Seus dados', 'Pagamento', 'Acompanhamento'].map((label, i) => (
        <li
          key={label}
          className={`step min-w-0 !flex-col sm:!flex-row ${i === step ? 'active' : ''}`}
          aria-current={i === step ? 'step' : undefined}
        >
          <span>{i + 1}</span>
          <span className="!block !h-auto !w-auto !border-0 !bg-transparent !text-inherit max-w-full break-words text-center text-[11px] sm:text-sm">
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
