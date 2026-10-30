classdef BraccioWebScene < matlab.System
%BRACCIOWEBSCENE Block "Web Scene Configuration" - Ersatz fuer Simulation 3D Scene Configuration.
%
%   Oeffnet den WebSocket-Server, mit dem sich BraccioSim (Reiter
%   "Co-Simulation") verbindet, und sendet mit der Abtastzeit SampleTime ein
%   Bild aller Web-Robot- und Web-Actor-Bloecke des Modells. Pro Modell genau
%   ein Block. Keine Ein- und Ausgaenge.
%
%   Die Simulation wird nicht gebremst; fuer eine fluessige Darstellung das
%   Modell auf Echtzeit bremsen (Simulation Pacing).
%
%   F. Bender, DHBW Stuttgart

    properties (Nontunable)
        Port = 8766             % TCP-Port des WebSocket-Servers
        SampleTime = 0.02       % Abstand der Bilder an den Browser [s]
    end

    methods
        function obj = BraccioWebScene(varargin)
            setProperties(obj, nargin, varargin{:});
        end
    end

    methods (Access = protected)
        function setupImpl(obj)
            BraccioWebHub.instance().start(obj.Port);
        end

        function stepImpl(obj)
            BraccioWebHub.instance().tick(getCurrentTime(obj));
        end

        function releaseImpl(~)
            BraccioWebHub.instance().stop();
        end

        function st = getSampleTimeImpl(obj)
            st = createSampleTime(obj, 'Type', 'Discrete', 'SampleTime', obj.SampleTime);
        end

        function icon = getIconImpl(obj)
            icon = sprintf('Web Scene\nConfiguration\nws://127.0.0.1:%d', obj.Port);
        end
    end

    methods (Static, Access = protected)
        function header = getHeaderImpl
            header = matlab.system.display.Header('BraccioWebScene', 'Title', 'Web Scene Configuration', ...
                'Text', ['Ersatz fuer Simulation 3D Scene Configuration: sendet die Szene per WebSocket an ' ...
                'BraccioSim (Reiter Co-Simulation). Ein Block pro Modell.']);
        end
    end
end
