export interface DetailedPoint {
    point: string;
    timestamp?: string;
}

export interface CardNode {
    id: string;
    title: string;
    type: 'concept' | 'argument' | 'data' | 'conclusion' | 'action';
    content: string; // The rich text overview / introduction
    timestamp?: string; // Overall timestamp for the card
    detailedPoints?: DetailedPoint[]; // NEW: Fine-grained list items
    relations: {
        targetId: string;
        type: string;
        label: string;
    }[];
}

export interface Chapter {
    id: string;
    title: string;
    nodes: CardNode[];
}

export interface TermDefinition {
    term: string;
    brief: string;
}

export interface AIRawResult {
    chapters?: Chapter[];
    terms?: TermDefinition[];
}
