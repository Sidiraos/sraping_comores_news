const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const app = express();

// Fonction pour ajouter un délai
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fonction pour scraper les articles de La Gazette des Comores
const scrapeLagazette = async (url) => {
	try {
		const { data } = await axios.get(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
			},
		});
		const $ = cheerio.load(data);

		const articles = await Promise.all(
			$('.actu-mini')
				.map(async (i, el) => {
					const image = $(el)
						.find('.actu-mini-img a img')
						.attr('src');
					const lien_article = $(el)
						.find('.actu-mini-caption a')
						.attr('href');
					const title = $(el).find('.actu-mini-caption h5').text();
					const date = $(el)
						.find('.actu-mini-footer div > ul > li:nth-child(1)')
						.text();
					const categorie = $(el)
						.find('.actu-mini-footer div > ul > li:nth-child(3) a')
						.text();

					if (!image || !lien_article || !title) return null;

					const article = {
						id: uuidv4(),
						image: 'https://lagazettedescomores.com/' + image,
						title: title.trim(),
						detail_link:
							'https://lagazettedescomores.com/' + lien_article,
						date: date.trim(),
						categorie: categorie.trim(),
					};

					// Récupérer le contenu de l'article détaillé
					const { data: detailHtml } = await axios.get(
						article.detail_link,
						{
							headers: {
								'User-Agent':
									'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
							},
						}
					);
					const $detail = cheerio.load(detailHtml);

					const article_summary = $detail(
						'.article-in div:nth-child(3) .article-content p'
					)
						.not(':last')
						.text();

					article['body'] = article_summary.trim();
					return article;
				})
				.get()
		);

		return articles.filter(Boolean);
	} catch (error) {
		console.error(
			'Erreur lors du scraping de La Gazette des Comores :',
			error.message
		);
		return [];
	}
};

// Fonction pour scraper les articles de Comores Infos avec gestion des erreurs et réessai
const scrapeComoresInfos = async (url) => {
	const maxRetries = 3;
	let retries = 0;

	while (retries < maxRetries) {
		try {
			const { data } = await axios.get(url, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
				},
			});
			const $ = cheerio.load(data);

			const articles = await Promise.all(
				$('article')
					.map(async (i, el) => {
						const detail_link = $(el)
							.find('div:nth-child(1) a')
							.attr('href');
						const title = $(el)
							.find('div:nth-child(1) a')
							.attr('title');

						if (!detail_link || !title) return null;

						let detailUrl;
						let attempts = 0;
						while (attempts < 3) {
							try {
								const { data: detailHtml } = await axios.get(
									detail_link,
									{
										headers: {
											'User-Agent':
												'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
										},
									}
								);
								detailUrl = detailHtml;
								break;
							} catch (error) {
								if (
									error.response &&
									error.response.status === 503
								) {
									console.error(
										`Erreur 503 lors du scraping de l'article ${title}. Réessai ${
											attempts + 1
										}/3`
									);
									attempts++;
									await delay(2000); // Attendre 2 secondes avant de réessayer
								} else {
									console.error(
										`Erreur lors du scraping de l'article ${title} :`,
										error.message
									);
									return null;
								}
							}
						}

						if (!detailUrl) return null;

						const $detail = cheerio.load(detailUrl);

						const image = $detail('.entry-content a > img').attr(
							'src'
						);
						const body = $detail('.entry-content p').text();
						const categorie = $detail(
							'.entry-header p span.entry-meta-categories a:nth-child(2)'
						).text();
						const date = $detail(
							'.entry-header p span.entry-meta-date a'
						).text();

						const article = {
							id: uuidv4(),
							image: image ? image.trim() : null,
							title: title.trim(),
							date: date.trim(),
							body: body.trim(),
							categorie: categorie.trim(),
							detail_link: detail_link.trim(),
						};
						return article;
					})
					.get()
			);

			return articles.filter(Boolean);
		} catch (error) {
			if (error.response && error.response.status === 503) {
				console.error(
					`Erreur 503 lors du scraping de Comores Infos. Réessai ${
						retries + 1
					}/${maxRetries}`
				);
				retries++;
				await delay(2000); // Attendre 2 secondes avant de réessayer
			} else {
				console.error(
					'Erreur lors du scraping de Comores Infos :',
					error.message
				);
				return [];
			}
		}
	}
	return [];
};

app.get('/scrape', async (req, res) => {
	try {
		const websiteURL = 'https://www.lagazettedescomores.com';
		const url2 = 'https://www.comoresinfos.net/';

		const [articleLagazette, articleComoresinfos] = await Promise.all([
			scrapeLagazette(websiteURL),
			scrapeComoresInfos(url2),
		]);

		// Concaténer les articles des deux sites
		const articles = [...articleLagazette, ...articleComoresinfos];

		// Retourner les articles dans la réponse
		res.json(articles);
	} catch (error) {
		console.error('Erreur lors du scraping :', error.message);
		res.status(500).json({ error: 'Erreur lors du scraping' });
	}
});

const categories = [
	{
		id: 'politique',
		label: 'Politique',
	},
	{
		id: 'sport',
		label: 'Sports',
	},
	{
		id: 'sante',
		label: 'Santé',
	},
	{
		id: 'religion',
		label: 'Religion',
	},
	{
		id: 'culture',
		label: 'Culture',
	},
	{
		id: 'soc',
		label: 'Société',
	},
	{
		id: 'eco',
		label: 'Économie',
	},
];

app.get('/categories', (req, res) => {
	res.json(categories);
});

app.listen(3000, () => {
	console.log('Serveur en écoute sur le port 3000');
});
