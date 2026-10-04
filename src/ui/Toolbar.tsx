import { ACCEPT } from '../io/index';

interface Props {
  name: string | null;
  readout: string;
  status: string;
  busy: boolean;
  canExport: boolean;
  canExportStrides: boolean;
  onOpen: (files: File[]) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}

export function Toolbar({ name, readout, status, busy, canExport, canExportStrides, onOpen, onExportJson, onExportCsv }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="wordmark">MORPHXGEN</span>
        <span className="toolbar__tool">human_data_capture</span>
      </div>

      <div className="toolbar__status">
        {name && <span>{name}</span>}
        {readout && <span className="muted">{readout}</span>}
        <span className={busy ? 'status status--busy' : 'status'}>{status}</span>
      </div>

      <div className="toolbar__actions">
        <label className="btn">
          open
          <input
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) onOpen(files);
              e.target.value = '';
            }}
          />
        </label>
        <button className="btn" disabled={!canExportStrides} onClick={onExportCsv}>
          strides.csv
        </button>
        <button className="btn btn--primary" disabled={!canExport} onClick={onExportJson}>
          export report
        </button>
      </div>
    </header>
  );
}
