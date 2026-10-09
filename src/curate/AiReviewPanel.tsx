import type { CuratedMemeData } from "./curateTypes";

interface AiReviewPanelProps {
  j4?: CuratedMemeData | null;
  j5?: CuratedMemeData | null;
  aiState: 'A' | 'B' | 'C';
  allDetailsMatch: boolean;
  onEnterOverride: () => void;
  onAdopt: (j: CuratedMemeData) => void;
}

export default function AiReviewPanel({ j4, j5, aiState, allDetailsMatch, onEnterOverride, onAdopt }: AiReviewPanelProps) {
  const renderJudgeCard = (judgeName: string, j?: CuratedMemeData | null, shortcut?: string, onSelect?: () => void) => {
    if (!j) return null;
    return (
      <div 
        style={{ 
          background: "#1c1b1b", 
          border: "2px solid #555", 
          padding: "14px", 
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          cursor: onSelect ? "pointer" : "default"
        }}
        onClick={onSelect}
      >
        <div style={{ fontSize: "16px", fontWeight: "bold", color: "#c58cff", borderBottom: "1px solid #333", paddingBottom: "6px" }}>
          {judgeName} <span style={{ color: "#fff" }}>→ {j.corpus_status.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: "13px", color: "#ddd" }}>
          <div><span style={{ color: "#888" }}>Topics:</span> {j.topics.join(", ") || "None"}</div>
          <div><span style={{ color: "#888" }}>Tone:</span> {j.tone || "None"}</div>
          <div><span style={{ color: "#888" }}>Mechs:</span> {j.humour_mechanisms.join(", ") || "None"}</div>
        </div>
        {shortcut && (
          <div style={{ marginTop: "auto", paddingTop: "10px", textAlign: "center" }}>
            <span className="curate-key-pill">{shortcut}</span> ADOPT
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
      {aiState === 'A' && (
        <div style={{ background: "#1c1b1b", border: "2px solid #34C759", padding: "16px", textAlign: "center" }}>
          <div style={{ fontSize: "20px", color: "#34C759", fontFamily: "Anton", letterSpacing: "1px", marginBottom: "12px" }}>
            AI JUDGE 4 & 5 AGREE: <span style={{ color: "#fff" }}>{j4!.corpus_status.toUpperCase()}</span>
          </div>
          
          {allDetailsMatch ? (
            <>
              <div style={{ display: "flex", justifyContent: "center", gap: "16px", fontSize: "14px", color: "#ddd", marginBottom: "16px" }}>
                <div><span style={{ color: "#888" }}>Topics:</span> {j4!.topics.join(", ") || "None"}</div>
                <div><span style={{ color: "#888" }}>Tone:</span> {j4!.tone || "None"}</div>
                <div><span style={{ color: "#888" }}>Mechs:</span> {j4!.humour_mechanisms.join(", ") || "None"}</div>
              </div>
              <div style={{ color: "#34C759", fontSize: "14px", fontWeight: "bold" }}>
                PRESS [ENTER / SPACE] TO APPROVE AI JUDGEMENT
              </div>
            </>
          ) : (
            <div>
              <div style={{ color: "#f4c300", fontSize: "13px", marginBottom: "12px" }}>
                Status matches, but details differ. Select one to adopt:
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                {renderJudgeCard("AI Judge 4", j4, "4", () => onAdopt(j4!))}
                {renderJudgeCard("AI Judge 5", j5, "5", () => onAdopt(j5!))}
              </div>
            </div>
          )}
        </div>
      )}

      {aiState === 'B' && (
        <div>
          <div style={{ fontSize: "16px", color: "#FF9F0A", fontFamily: "Anton", letterSpacing: "1px", marginBottom: "12px", textAlign: "center" }}>
            AI JUDGE DISAGREEMENT
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            {renderJudgeCard("AI Judge 4", j4, "4", () => onAdopt(j4!))}
            {renderJudgeCard("AI Judge 5", j5, "5", () => onAdopt(j5!))}
          </div>
        </div>
      )}

      {aiState === 'C' && (
        <div style={{ background: "#1c1b1b", border: "2px solid #FF3B30", padding: "20px", textAlign: "center" }}>
          <div style={{ fontSize: "18px", color: "#FF3B30", fontFamily: "Anton", letterSpacing: "1px", marginBottom: "12px" }}>
            {(!j4 || !j5) ? "INCOMPLETE — AI HAS NOT FINISHED" : "AI RECOMMENDS EXCLUDE — CONFIRM MANUALLY"}
          </div>
          <div style={{ color: "#ddd", fontSize: "14px" }}>
            Fast-approve is unavailable for this meme.
          </div>
        </div>
      )}

      <button
        onClick={onEnterOverride}
        style={{
          background: "#262626",
          color: "#f4c300",
          border: "1px solid #f4c300",
          padding: "12px",
          fontFamily: "Anton",
          fontSize: "16px",
          cursor: "pointer",
          marginTop: "8px",
          boxShadow: "2px 2px 0px #f4c300"
        }}
      >
        MANUAL OVERRIDE [O]
      </button>
    </div>
  );
}
