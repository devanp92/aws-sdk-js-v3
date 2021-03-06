import {AbortController} from '@aws-sdk/abort-controller';
import {Server as HttpServer} from 'http';
import {Server as HttpsServer} from 'https';
import * as https from 'https';
import * as http from 'http';
import {NodeHttpHandler} from './node-http-handler';
import {ReadFromBuffers} from './readable.mock';
import {
    createMockHttpServer,
    createMockHttpsServer,
    createContinueResponseFunction,
    createResponseFunction
} from './server.mock';

const rejectUnauthorizedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

beforeEach(() => {
    // Setting the NODE_TLS_REJECT_UNAUTHORIZED will allow the unconfigurable
    // HTTPS client in getCertificate to skip cert validation, which the
    // self-signed cert used for this test's server would fail. The variable
    // will be reset to its original value at the end of the test.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
});

afterEach(() => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = rejectUnauthorizedEnv;
});

describe('NodeHttpHandler', () => {
    let mockHttpServer: HttpServer = createMockHttpServer().listen(5432);
    let mockHttpsServer: HttpsServer = createMockHttpsServer().listen(5433);

    afterEach(() => {
        mockHttpServer.removeAllListeners('request');
        mockHttpsServer.removeAllListeners('request');
        mockHttpServer.removeAllListeners('checkContinue');
        mockHttpsServer.removeAllListeners('checkContinue');
    });

    afterAll(() => {
        mockHttpServer.close();
        mockHttpsServer.close();
    })

    it('can send https requests', async () => {
        const mockResponse = {
            statusCode: 200,
            headers: {},
            body: 'test'
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        const nodeHttpHandler = new NodeHttpHandler();

        let response = await nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'GET',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {}
        }, {});

        expect(response.statusCode).toEqual(mockResponse.statusCode);
        expect(response.headers).toBeDefined();
        expect(response.headers).toMatchObject(mockResponse.headers);
        expect(response.body).toBeDefined();
    });

    it('can send http requests', async () => {
        const mockResponse = {
            statusCode: 200,
            headers: {},
            body: 'test'
        };
        mockHttpServer.addListener('request', createResponseFunction(mockResponse));
        const nodeHttpHandler = new NodeHttpHandler();

        let response = await nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'GET',
            port: mockHttpServer.address().port,
            protocol: 'http:',
            path: '/',
            headers: {}
        }, {});

        expect(response.statusCode).toEqual(mockResponse.statusCode);
        expect(response.headers).toBeDefined();
        expect(response.headers).toMatchObject(mockResponse.headers);
        expect(response.body).toBeDefined();
    });

    it('can send requests with bodies', async () => {
        const body = Buffer.from('test');
        const mockResponse = {
            statusCode: 200,
            headers: {}
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        const spy = jest.spyOn(https, 'request').mockImplementationOnce(() => {
            let calls = spy.mock.calls;
            let currentIndex = calls.length - 1;
            return https.request(calls[currentIndex][0], calls[currentIndex][1]);
        });

        const nodeHttpHandler = new NodeHttpHandler();
        let response = await nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'PUT',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {},
            body
        }, {});

        expect(response.statusCode).toEqual(mockResponse.statusCode);
        expect(response.headers).toBeDefined();
        expect(response.headers).toMatchObject(mockResponse.headers);
    });

    it('can handle expect 100-continue', async () => {
        const body = Buffer.from('test');
        const mockResponse = {
            statusCode: 200,
            headers: {}
        };

        mockHttpsServer.addListener('checkContinue', createContinueResponseFunction(mockResponse));
        let endSpy: jest.SpyInstance<any>;
        let continueWasTriggered = false;
        const spy = jest.spyOn(https, 'request').mockImplementationOnce(() => {
            let calls = spy.mock.calls;
            let currentIndex = calls.length - 1;
            const request = https.request(calls[currentIndex][0], calls[currentIndex][1]);
            request.on('continue', () => {
                continueWasTriggered = true;
            });
            endSpy = jest.spyOn(request, 'end');

            return request;
        });

        const nodeHttpHandler = new NodeHttpHandler();
        let response = await nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'PUT',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {
                'Expect': '100-continue'
            },
            body
        }, {});

        expect(response.statusCode).toEqual(mockResponse.statusCode);
        expect(response.headers).toBeDefined();
        expect(response.headers).toMatchObject(mockResponse.headers);
        expect(endSpy!.mock.calls.length).toBe(1);
        expect(endSpy!.mock.calls[0][0]).toBe(body);
        expect(continueWasTriggered).toBe(true);
    });

    it('can send requests with streaming bodies', async () => {
        const body = new ReadFromBuffers({
            buffers: [
                Buffer.from('t'),
                Buffer.from('e'),
                Buffer.from('s'),
                Buffer.from('t'),
            ]
        });
        let inputBodySpy = jest.spyOn(body, 'pipe');
        const mockResponse = {
            statusCode: 200,
            headers: {}
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        const nodeHttpHandler = new NodeHttpHandler();

        let response = await nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'PUT',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {},
            body
        }, {});

        expect(response.statusCode).toEqual(mockResponse.statusCode);
        expect(response.headers).toBeDefined();
        expect(response.headers).toMatchObject(mockResponse.headers);
        expect(inputBodySpy.mock.calls.length).toBeTruthy();
    });

    it('rejects if the request encounters an error', async () => {
        const mockResponse = {
            statusCode: 200,
            headers: {},
            body: 'test'
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        const nodeHttpHandler = new NodeHttpHandler();

        await expect(nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'GET',
            port: mockHttpsServer.address().port,
            protocol: 'fake:', // trigger a request error
            path: '/',
            headers: {}
        }, {})).rejects.toHaveProperty('message');
    });

    it('will not make request if already aborted', async () => {
        const mockResponse = {
            statusCode: 200,
            headers: {},
            body: 'test'
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        const spy = jest.spyOn(https, 'request').mockImplementationOnce(() => {
            let calls = spy.mock.calls;
            let currentIndex = calls.length - 1;
            return https.request(calls[currentIndex][0], calls[currentIndex][1]);
        });
        // clear data held from previous tests
        spy.mockClear();
        const nodeHttpHandler = new NodeHttpHandler();

        await expect(nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'GET',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {}
        }, {
            abortSignal: {
                aborted: true
            }
        })).rejects.toHaveProperty('name', 'AbortError');

        expect(spy.mock.calls.length).toBe(0);
    });

    it('will destroy the request when aborted', async () => {
        const mockResponse = {
            statusCode: 200,
            headers: {},
            body: 'test'
        };
        mockHttpsServer.addListener('request', createResponseFunction(mockResponse));
        let httpRequest: http.ClientRequest;
        let reqAbortSpy: any;
        const spy = jest.spyOn(https, 'request').mockImplementationOnce(() => {
            let calls = spy.mock.calls;
            let currentIndex = calls.length - 1;
            httpRequest = https.request(calls[currentIndex][0], calls[currentIndex][1]);
            reqAbortSpy = jest.spyOn(httpRequest, 'abort');
            return httpRequest;
        });
        const nodeHttpHandler = new NodeHttpHandler();
        const abortController = new AbortController();

        setTimeout(() => {abortController.abort()}, 0);

        await expect(nodeHttpHandler.handle({
            hostname: 'localhost',
            method: 'GET',
            port: mockHttpsServer.address().port,
            protocol: 'https:',
            path: '/',
            headers: {}
        }, {
            abortSignal: abortController.signal
        })).rejects.toHaveProperty('name', 'AbortError');

        expect((reqAbortSpy).mock.calls.length).toBe(1);
    });

    describe('#destroy', () => {
        it('should be callable and return nothing', () => {
            const nodeHttpHandler = new NodeHttpHandler();
            expect(nodeHttpHandler.destroy()).toBeUndefined();
        });
    });
});
