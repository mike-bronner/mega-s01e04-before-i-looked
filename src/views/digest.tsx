import type { MarkedDigest } from '../digest/types.js';

export const MARK = '⚠';

const cell = (value: string | number | null) => (value === null || value === '' ? '—' : String(value));

export function Digest({ night, digest }: { night: string; digest: MarkedDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>
                  {cell(row.job)}
                  {row.marked && <span class="warn"> {MARK}</span>}
                </td>
                <td>{cell(row.owner)}</td>
                <td>{cell(row.runs)}</td>
                <td>{cell(row.retries)}</td>
                <td>{cell(row.lastStatus)}</td>
                <td>{cell(row.lastError)}</td>
                <td>{cell(row.firstAt)}</td>
                <td>{cell(row.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
