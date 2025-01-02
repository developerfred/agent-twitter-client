import { TweetAnalyzer } from './summary';
import { Scraper } from './scraper';
import type { Tweet } from './tweets';
import type { Profile } from './profile';

jest.mock('./scraper');

describe('TweetAnalyzer', () => {
    let scraper: jest.Mocked<Scraper>;
    let analyzer: TweetAnalyzer;

    const mockTweet = (
        id: string,
        text: string,
        likes: number,
        retweets: number,
        date: string
    ): Readonly<Tweet> => ({
        id,
        text,
        likes,
        retweets,
        date,
        isRetweet: false,
    } as const);

    const mockProfile = (
        userId: string,
        username: string
    ): Readonly<Profile> => ({
        userId,
        username,
    } as const);

    beforeEach(() => {
        scraper = new Scraper() as jest.Mocked<Scraper>;
        analyzer = new TweetAnalyzer(scraper, {
            maxBulletPoints: 5,
            minEngagement: 50
        });
    });

    describe('getFeedSummary', () => {
        const period = {
            start: new Date('2024-01-01'),
            end: new Date('2024-01-31')
        } as const;

        it('should generate bullet points for tweets', async () => {
            const mockFollows = [mockProfile('123', 'user1')];
            const mockTweets = [
                mockTweet('1', '#AI Latest developments in AI', 150, 50, '2024-01-15T00:00:00Z'),
                mockTweet('2', 'More #AI news today', 200, 75, '2024-01-16T00:00:00Z')
            ];

            scraper.getFollowing = jest.fn().mockImplementation(async function* () {
                yield* mockFollows;
            });

            scraper.getTweetsByUserId = jest.fn().mockImplementation(async function* () {
                yield* mockTweets;
            });

            const summaries = await analyzer.getFeedSummary('user123', period);

            expect(summaries).toHaveLength(1);
            expect(summaries[0].user).toBe('user1');
            expect(summaries[0].points).toHaveLength(expect.any(Number));
            expect(summaries[0].points.some(p => p.includes('🔥'))).toBe(true);
            expect(summaries[0].points.some(p => p.includes('📝'))).toBe(true);
            expect(summaries[0].points.some(p => p.includes('AI'))).toBe(true);
        });

        it('should filter tweets outside date range', async () => {
            const mockFollows = [mockProfile('123', 'user1')];
            const mockTweets = [
                mockTweet('1', 'Old tweet', 100, 50, '2023-12-31T00:00:00Z'),
                mockTweet('2', 'New tweet', 200, 75, '2024-01-15T00:00:00Z')
            ];

            scraper.getFollowing = jest.fn().mockImplementation(async function* () {
                yield* mockFollows;
            });

            scraper.getTweetsByUserId = jest.fn().mockImplementation(async function* () {
                yield* mockTweets;
            });

            const summaries = await analyzer.getFeedSummary('user123', period);

            expect(summaries[0].points.some(p => p.includes('New tweet'))).toBe(true);
            expect(summaries[0].points.some(p => p.includes('Old tweet'))).toBe(false);
        });

        it('should handle empty tweet lists', async () => {
            const mockFollows = [mockProfile('123', 'user1')];

            scraper.getFollowing = jest.fn().mockImplementation(async function* () {
                yield* mockFollows;
            });

            scraper.getTweetsByUserId = jest.fn().mockImplementation(async function* () { });

            const summaries = await analyzer.getFeedSummary('user123', period);
            expect(summaries).toHaveLength(0);
        });

        it('should respect maxBulletPoints config', async () => {
            const mockFollows = [mockProfile('123', 'user1')];
            const mockTweets = Array.from({ length: 10 }, (_, i) =>
                mockTweet(
                    i.toString(),
                    `Tweet ${i}`,
                    100 + i * 10,
                    50 + i * 5,
                    '2024-01-15T00:00:00Z'
                )
            );

            scraper.getFollowing = jest.fn().mockImplementation(async function* () {
                yield* mockFollows;
            });

            scraper.getTweetsByUserId = jest.fn().mockImplementation(async function* () {
                yield* mockTweets;
            });

            const summaries = await analyzer.getFeedSummary('user123', period);
            expect(summaries[0].points.length).toBeLessThanOrEqual(5);
        });
    });
});