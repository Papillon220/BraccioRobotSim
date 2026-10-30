classdef BraccioWebHub < handle
%BRACCIOWEBHUB Gemeinsame WebSocket-Verbindung der Bloecke Web Scene Configuration, Web Robot und Web Actor.
%
%   Die Bloecke tragen ihre Akteure hier ein (register) und aktualisieren sie
%   in jedem Schritt (update, setRobot). Der Block Web Scene Configuration
%   betreibt den WebSocket-Server auf ws://127.0.0.1:<Port> und sendet:
%     - nach dem Verbinden die Szene (Form, Groesse, Farbe, Startlage aller Akteure)
%     - in jedem seiner Schritte ein Bild (Roboter und Akteure mit Eingaengen)
%   Alle Lagen im Labor-KS0 (MATLAB-KS); die Unreal-Angaben (y gespiegelt)
%   rechnen die Bloecke vorher um.
%
%   Nachrichten (JSON):
%     {type:'scene', actors:[{n, shape, size, color, alpha, p, r, s}], wallX}
%     {type:'frame', t, q:[q1..q5], q6, actors:[{n, p, r, color, alpha}]}
%
%   F. Bender, DHBW Stuttgart
%   31.10.26 - Initial version (Ersatz der Simulation-3D-Bloecke)

    properties
        Defs = struct('n', {}, 'shape', {}, 'size', {}, 'color', {}, 'alpha', {}, 'p', {}, 'r', {}, 's', {})
        State = struct('n', {}, 'p', {}, 'r', {}, 'color', {}, 'alpha', {})   % Akteure mit Eingaengen
        Robot = struct('q', [0 pi/2 0 pi/2 0], 'q6', 10*pi/180)
    end
    properties (SetAccess = private)
        Srv = []                % tcpserver
        Open = false            % WebSocket-Handshake erfolgt
        SceneSent = false
        RxBuf = uint8([])
    end
    properties (Constant, Access = private)
        GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'   % RFC 6455
    end

    methods (Static)
        function h = instance(reset)
        %INSTANCE Die eine Verbindung dieser MATLAB-Sitzung (reset = true: neu anlegen)
            persistent hub
            if nargin > 0 && reset && ~isempty(hub) && isvalid(hub)
                hub.stop();
                delete(hub);
            end
            if isempty(hub) || ~isvalid(hub)
                hub = BraccioWebHub();
            end
            h = hub;
        end
    end

    methods
        function register(obj, def)
        %REGISTER Akteur eintragen (ersetzt einen gleichnamigen)
            k = find(strcmp({obj.Defs.n}, def.n), 1);
            if isempty(k), k = numel(obj.Defs) + 1; end
            obj.Defs(k) = def;
            obj.SceneSent = false;
        end

        function update(obj, name, p, r, color, alpha)
        %UPDATE Lage/Farbe/Transparenz eines Akteurs (leere Argumente = unveraendert)
            k = find(strcmp({obj.State.n}, name), 1);
            if isempty(k)
                k = numel(obj.State) + 1;
                obj.State(k).n = name;
            end
            if ~isempty(p), obj.State(k).p = p; end
            if ~isempty(r), obj.State(k).r = r; end
            if ~isempty(color), obj.State(k).color = color; end
            if ~isempty(alpha), obj.State(k).alpha = alpha; end
        end

        function setRobot(obj, q, q6)
            obj.Robot.q = q;
            obj.Robot.q6 = q6;
        end

        function start(obj, port)
            if ~isempty(obj.Srv), return, end
            try
                obj.Srv = tcpserver("127.0.0.1", port, "Timeout", 1);
            catch err
                error('BraccioWebViz:Port', ['Port %d ist belegt (%s).\n' ...
                    'Laeuft noch eine andere Simulation oder BraccioWebViz_test? ' ...
                    'Sonst BraccioWebHub.instance(true) ausfuehren oder einen anderen Port waehlen.'], port, err.message);
            end
            obj.Open = false;
            obj.RxBuf = uint8([]);
            fprintf('BraccioWebViz: warte auf BraccioSim unter ws://127.0.0.1:%d (Reiter Co-Simulation)\n', port);
        end

        function stop(obj)
            if ~isempty(obj.Srv)
                if obj.Open
                    try
                        write(obj.Srv, uint8([136 0]), "uint8");   % Close-Frame
                    catch
                    end
                end
                delete(obj.Srv);
                obj.Srv = [];
                fprintf('BraccioWebViz: Server beendet\n');
            end
            obj.Open = false;
            obj.Defs = obj.Defs([]);
            obj.State = obj.State([]);
        end

        function tick(obj, t)
        %TICK Verbindung bedienen und ein Bild senden (vom Block Web Scene Configuration)
            s = obj.Srv;
            if isempty(s), return, end
            if ~s.Connected
                if obj.Open
                    fprintf('BraccioWebViz: Browser getrennt\n');
                end
                obj.Open = false;
                obj.RxBuf = uint8([]);
                return
            end
            data = uint8([]);
            nb = s.NumBytesAvailable;
            if nb > 0
                data = uint8(read(s, nb, "uint8"));     % nach dem Handshake: nichts Relevantes (ggf. Close)
            end
            if ~obj.Open
                obj.handshake(data);
                if ~obj.Open, return, end
            end
            if ~obj.SceneSent
                obj.sendText(jsonencode(struct('type', 'scene', 'actors', obj.Defs)));
                obj.SceneSent = true;
            end
            msg = struct('type', 'frame', 't', t, 'q', obj.Robot.q, 'q6', obj.Robot.q6, 'actors', obj.State);
            obj.sendText(jsonencode(msg));
        end
    end

    methods (Access = private)
        function handshake(obj, data)
        % HTTP-Upgrade-Anfrage des Browsers beantworten (RFC 6455)
            obj.RxBuf = [obj.RxBuf, data(:)'];
            req = char(obj.RxBuf);
            if ~contains(req, [char([13 10]) char([13 10])])
                return                          % Anfrage noch unvollstaendig
            end
            obj.RxBuf = uint8([]);
            key = regexp(req, 'Sec-WebSocket-Key:\s*([^\r\n]+)', 'tokens', 'once', 'ignorecase');
            if isempty(key)
                resp = sprintf(['HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\n' ...
                    'Connection: close\r\n\r\nBraccioWebViz: bitte mit BraccioSim (Reiter Co-Simulation) verbinden.\r\n']);
                write(obj.Srv, uint8(resp), "uint8");
                return
            end
            accept = matlab.net.base64encode(BraccioWebHub.sha1(uint8([strtrim(key{1}) BraccioWebHub.GUID])));
            resp = sprintf(['HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' ...
                'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n'], accept);
            write(obj.Srv, uint8(resp), "uint8");
            obj.Open = true;
            obj.SceneSent = false;
            fprintf('BraccioWebViz: BraccioSim verbunden\n');
        end

        function sendText(obj, txt)
        % Text-Frame ohne Maske (Server -> Client)
            p = unicode2native(txt, 'UTF-8');
            p = p(:)';
            n = numel(p);
            if n < 126
                hdr = uint8([129 n]);
            elseif n < 65536
                hdr = uint8([129 126 floor(n/256) mod(n, 256)]);
            else
                hdr = [uint8([129 127]) fliplr(typecast(uint64(n), 'uint8'))];
            end
            try
                write(obj.Srv, [hdr p], "uint8");
            catch
                obj.Open = false;               % Browser inzwischen getrennt
            end
        end
    end

    methods (Static)
        function h = sha1(msg)
        %SHA1 SHA-1-Pruefsumme (20 Byte) - ueber Java, sonst in MATLAB gerechnet
            msg = uint8(msg(:)');
            if usejava('jvm')
                try
                    md = java.security.MessageDigest.getInstance('SHA-1');
                    h = typecast(int8(md.digest(typecast(msg, 'int8'))), 'uint8');
                    h = h(:)';
                    return
                catch
                end
            end
            h = BraccioWebHub.sha1Matlab(msg);
        end

        function h = sha1Matlab(msg)
        %SHA1MATLAB SHA-1 nach FIPS 180-4 ohne Java
            msg = uint8(msg(:)');
            nBits = numel(msg) * 8;
            msg = [msg uint8(128) zeros(1, mod(55 - numel(msg), 64), 'uint8')];
            len = zeros(1, 8, 'uint8');
            for k = 8:-1:1
                len(k) = mod(nBits, 256);
                nBits = floor(nBits / 256);
            end
            msg = [msg len];
            H = uint32([1732584193 4023233417 2562383102 271733878 3285377520]);
            K = uint32([1518500249 1859775393 2400959708 3395469782]);
            rol = @(x, n) bitor(bitshift(x, n), bitshift(x, n - 32));
            add = @(varargin) uint32(mod(sum(cellfun(@double, varargin)), 2^32));
            for c = 1:64:numel(msg)
                b = uint32(msg(c:c+63));
                w = zeros(1, 80, 'uint32');
                for i = 1:16
                    w(i) = bitor(bitor(bitshift(b(4*i-3), 24), bitshift(b(4*i-2), 16)), ...
                                 bitor(bitshift(b(4*i-1), 8), b(4*i)));
                end
                for i = 17:80
                    w(i) = rol(bitxor(bitxor(w(i-3), w(i-8)), bitxor(w(i-14), w(i-16))), 1);
                end
                a = H(1); bb = H(2); cc = H(3); d = H(4); e = H(5);
                for i = 1:80
                    if i <= 20
                        f = bitor(bitand(bb, cc), bitand(bitcmp(bb), d)); k = K(1);
                    elseif i <= 40
                        f = bitxor(bitxor(bb, cc), d); k = K(2);
                    elseif i <= 60
                        f = bitor(bitor(bitand(bb, cc), bitand(bb, d)), bitand(cc, d)); k = K(3);
                    else
                        f = bitxor(bitxor(bb, cc), d); k = K(4);
                    end
                    tmp = add(rol(a, 5), f, e, k, w(i));
                    e = d; d = cc; cc = rol(bb, 30); bb = a; a = tmp;
                end
                H = [add(H(1), a) add(H(2), bb) add(H(3), cc) add(H(4), d) add(H(5), e)];
            end
            h = zeros(1, 20, 'uint8');
            for i = 1:5
                h(4*i-3:4*i) = uint8([bitshift(H(i), -24) bitand(bitshift(H(i), -16), 255) ...
                                      bitand(bitshift(H(i), -8), 255) bitand(H(i), 255)]);
            end
        end

        function ok = selfTest()
        %SELFTEST Prueft den WebSocket-Handshake mit dem Beispiel aus RFC 6455
            key = uint8(['dGhlIHNhbXBsZSBub25jZQ==' BraccioWebHub.GUID]);
            expected = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';
            ok = strcmp(matlab.net.base64encode(BraccioWebHub.sha1(key)), expected) && ...
                 strcmp(matlab.net.base64encode(BraccioWebHub.sha1Matlab(key)), expected);
        end

        function [p, r] = fromUnreal(p, r)
        %FROMUNREAL Lage aus dem Unreal-KS (y gespiegelt, [roll -pitch -yaw]) ins Labor-KS0
            p = double(p(:)');
            p(2) = -p(2);
            if nargin > 1 && ~isempty(r)
                r = double(r(:)');
                r(2:3) = -r(2:3);
            end
        end
    end
end
