import { NextRequest, NextResponse } from "next/server";
import {
	ActionError,
	ActionGetResponse,
	ActionPostRequest,
	ActionPostResponse,
	CompletedAction,
	createPostResponse,
} from "@solana/actions";
import {
	Connection,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";

import {
	HEADERS,
	URL_PATH,
	CLUSTER_URL,
	PROCESSING_FEE,
} from "@/helpers/utils";

import { fetchGameData, checkIfUserCanPlay } from "@/helpers/game";

const TO_PUBKEY = new PublicKey(process.env.PROGRAM_ACCOUNT!);

export async function GET(
	req: NextRequest,
	context: { params: { gameId: string } }
) {
	const gameId = context.params.gameId;
	const game = await fetchGameData(gameId);

	let payload: ActionGetResponse | CompletedAction;

	if (game._meta.state[0] != "ONGOING") {
		const url = new URL(req.url);
		const result =
			game._meta.state[0] == "TIE"
				? "Twas a tie"
				: `${game._meta.state[1]} won`;

		payload = {
			type: "completed",
			title: "Game over!",
			icon: game._meta.image_url,
			label: "Game over!",
			description: `This game has ended. ${result},\nTo create a new game, go to ${url.origin}/new/`,
		} as CompletedAction;
	} else {
		const owner = game._meta.owner;
		const char = owner.mark == "x" ? "o" : "x";

		if (game.moves.length == 0) {
			payload = {
				title: "Your turn!",
				icon: game._meta.image_url,
				description: `${
					owner.username
				} picked ${owner.mark.toUpperCase()}, hence you are ${char.toUpperCase()} and you get to play first.\n\nWhat move shall you play?`,
				label: "Play",
				links: {
					actions: [
						{
							type: "transaction",
							href: `${URL_PATH}/play/${gameId}?&username={username}&move={move}&char=${char}`,
							label: "Play",
							parameters: [
								{
									type: "text",
									name: "username",
									label: "Enter your username",
									required: true,
								},
								{
									type: "select",
									options: game.options.map((position) => {
										return {
											label: position,
											value: position,
										};
									}),
									name: "move",
									label: "Play this move",
									required: true,
								},
							],
						},
					],
				},
			} as ActionGetResponse;
		} else {
			payload = {
				title: "Your turn!",
				icon: game._meta.image_url,
				description: "What move shall you play?",
				label: "Play",
				links: {
					actions: [
						{
							type: "transaction",
							href: `${URL_PATH}/play/${gameId}?move={move}&char=${char}`,
							label: "Play",
							parameters: [
								{
									type: "select",
									options: game.options.map((position) => {
										return {
											label: position,
											value: position,
										};
									}),
									name: "move",
									label: "Play this move",
									required: true,
								},
							],
						},
					],
				},
			} as ActionGetResponse;
		}
	}

	return NextResponse.json(payload, { status: 200, headers: HEADERS });
}

export async function POST(
	req: NextRequest,
	context: { params: { gameId: string } }
) {
	try {
		const body: ActionPostRequest = await req.json();
		if (!body.account?.trim()) {
			throw new Error("`account` field is required");
		}

		let payer: PublicKey;
		try {
			payer = new PublicKey(body.account);
		} catch (err: any) {
			throw new Error("Invalid account provided: not a valid public key");
		}

		// Check if an address can play and if it's thier turn
		const gameId = context.params.gameId;
		const userCanPlay = await checkIfUserCanPlay(gameId, payer.toString());
		if (!userCanPlay[0]) throw new Error(userCanPlay[1]);

		const connection = new Connection(CLUSTER_URL);
		const { blockhash } = await connection.getLatestBlockhash();

		const processPlay = SystemProgram.transfer({
			fromPubkey: payer,
			toPubkey: TO_PUBKEY,
			lamports: PROCESSING_FEE * LAMPORTS_PER_SOL,
		});

		const message = new TransactionMessage({
			payerKey: payer,
			recentBlockhash: blockhash,
			instructions: [processPlay],
		}).compileToV0Message();

		const tx = new VersionedTransaction(message);

		const url = new URL(req.url);
		const move = url.searchParams.get("move");
		const char = url.searchParams.get("char");
		const username = url.searchParams.get("username");
		if (!move?.trim() || !char?.trim()) {
			throw new Error("Required fields are missing: move and char");
		}

		const payload: ActionPostResponse = await createPostResponse({
			fields: {
				type: "transaction",
				transaction: tx,
				links: {
					next: {
						type: "post",
						href: `${URL_PATH}/play/${gameId}/confirm?move=${move}&char=${char}&username=${username}&payer=${payer}`,
					},
				},
			},
		});

		return NextResponse.json(payload, { status: 200, headers: HEADERS });
	} catch (err: any) {
		console.log({ err });
		return NextResponse.json({ message: err.message } as ActionError, {
			status: 400,
			headers: HEADERS,
		});
	}
}

export const OPTIONS = GET;
