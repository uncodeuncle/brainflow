"use client";

import React, { useMemo, useEffect, useCallback } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType,
    BackgroundVariant,
    ConnectionLineType,
    Node,
    Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ChapterNode } from './flow-nodes/ChapterNode';
import { CardFlowNode } from './flow-nodes/CardFlowNode';
import { RootNode } from './flow-nodes/RootNode';
import { Chapter as IChapter, TermDefinition } from '@/types/brain';

const nodeTypes = {
    rootNode: RootNode,
    chapterNode: ChapterNode,
    cardFlowNode: CardFlowNode,
};

interface InteractiveFlowProps {
    title: string;
    chapters: IChapter[];
    terms: TermDefinition[];
    isCollection?: boolean;
}

export function InteractiveFlow({ title, chapters, terms, isCollection }: InteractiveFlowProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        if (!chapters || chapters.length === 0) return;

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        // Vertical spacing between chapters
        const CHAPTER_V_SPACING = 500;
        const rootY = Math.max((chapters.length - 1) * CHAPTER_V_SPACING / 2, 0);

        // 1. Add Root Node (Video/Collection Title)
        const rootNodeId = 'root_node';
        newNodes.push({
            id: rootNodeId,
            type: 'rootNode',
            position: { x: 50, y: rootY + 100 }, // +100 to account for top padding
            data: { title: title || '知识全景图', chaptersCount: chapters.length },
        });

        chapters.forEach((chapter, cIdx) => {
            const currentY = cIdx * CHAPTER_V_SPACING + 100;
            const chapterX = 450; // Chapter column

            // 2. Add Chapter Node
            const chapterNodeId = `chap_${chapter.id}`;
            newNodes.push({
                id: chapterNodeId,
                type: 'chapterNode',
                position: { x: chapterX, y: currentY },
                data: { title: chapter.title, nodesCount: chapter.nodes?.length || 0 },
            });

            // Link Root -> Chapter
            newEdges.push({
                id: `e_root_${chapterNodeId}`,
                source: rootNodeId,
                target: chapterNodeId,
                type: 'smoothstep',
                animated: true,
                style: { stroke: 'rgba(251, 114, 153, 0.4)', strokeWidth: 2 }, // Keep primary color for root -> chapter if desired, or change to something softer
            });

            // 3. Add Card Nodes horizontally to the right of the Chapter
            if (chapter.nodes && chapter.nodes.length > 0) {
                chapter.nodes.forEach((node, nIdx) => {
                    const nodeId = `node_${chapter.id}_${node.id}`;
                    const nodeX = chapterX + 400 + (nIdx * 450); // Spaced horizontally

                    // The label to show BEFORE the next node
                    const nextNodeRelation = node.relations?.find(r =>
                        chapter.nodes[nIdx + 1] && r.targetId === chapter.nodes[nIdx + 1].id
                    );

                    newNodes.push({
                        id: nodeId,
                        type: 'cardFlowNode',
                        position: { x: nodeX, y: currentY - 50 }, // slight offset to align centers roughly
                        data: {
                            node,
                            terms,
                            isCollection,
                            relationLabel: nextNodeRelation?.label || ''
                        },
                    });

                    // Link to previous node or chapter
                    if (nIdx === 0) {
                        newEdges.push({
                            id: `e_${chapterNodeId}_${nodeId}`,
                            source: chapterNodeId,
                            target: nodeId,
                            type: 'smoothstep',
                            animated: true,
                            style: { stroke: 'rgba(0, 0, 0, 0.2)', strokeWidth: 2 },
                        });
                    } else {
                        const prevNodeId = `node_${chapter.id}_${chapter.nodes[nIdx - 1].id}`;
                        newEdges.push({
                            id: `e_${prevNodeId}_${nodeId}`,
                            source: prevNodeId,
                            target: nodeId,
                            type: 'smoothstep',
                            animated: false,
                            style: { stroke: 'rgba(0, 0, 0, 0.1)', strokeWidth: 2 },
                            markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(0, 0, 0, 0.2)' },
                        });
                    }
                });
            }
        });

        setNodes(newNodes);
        setEdges(newEdges);
    }, [chapters, terms, setNodes, setEdges]);

    return (
        <div className="w-full h-full relative">
            {nodes.length > 0 ? (
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    connectionLineType={ConnectionLineType.SmoothStep}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    minZoom={0.1}
                    maxZoom={1.5}
                    proOptions={{ hideAttribution: true }} // Hide watermark
                    className="bg-transparent"
                >
                    <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(0, 0, 0, 0.1)" />
                    <Controls className="!fill-foreground !bg-white border-border rounded-md shadow-sm overflow-hidden !text-foreground" />
                    <MiniMap
                        className="!bg-white border border-border rounded-xl shadow-sm overflow-hidden"
                        nodeColor={(n) => {
                            if (n.type === 'chapterNode') return '#FB7299';
                            return 'rgba(0,0,0,0.1)';
                        }}
                        maskColor="rgba(255, 255, 255, 0.5)"
                    />
                </ReactFlow>
            ) : (
                <div className="h-full flex flex-col items-center justify-center pt-20">
                    <p className="text-muted-foreground font-medium">正在初始化逻辑图谱...</p>
                </div>
            )}
        </div>
    );
}
